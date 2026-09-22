import { Injectable, Logger } from '@nestjs/common';
import { SourceReaderService } from './source-reader.service';
import { extractIdentifiers, findUnknownIdentifiers } from './identifier-check';
import type { ToolCallRecord } from './dto/analysis.dto';
import type { IdentifierCheckView } from './dto/review.dto';

/** 대조 한 장의 입력 — listPending 의 카드 한 장(relatedFiles 는 이미 정규화된 저장소 경로) */
export interface IdentifierCheckInput {
  analysisId: number;
  incidentId: string;
  suggestedFix: string;
  relatedFiles: string[];
  toolCalls: ToolCallRecord[] | null;
  noteCodePath: string | null;
  noteCodeRef: string | null;
}

/**
 * 이름 대조 칩의 I/O 쪽(설계 §9 Phase 8 A) — 대조할 파일을 정하고 읽어서 순수 함수(identifier-check.ts)에 넘긴다.
 *
 * 대조 파일 = **인시던트 단위** 합집합: 메모의 코드 파일 ∪ 그 인시던트 카드들의 relatedFiles(정규화). 팔(v1.1·v3.1)마다 따로 정하면
 * relatedFiles 가 다른 만큼 대조 범위가 달라지고, 그 차이가 카드에 드러나 블라인드가 샌다(인수인계 A-2 ⚠). 같은 인시던트의 두 카드는
 * 반드시 같은 checkedFiles 를 받는다. 읽는 커밋(ref)도 인시던트 단위 — 메모 코드의 ref → 카드들의 tool_calls 첫 성공 ref → 기본 브랜치.
 *
 * 파일 읽기는 SourceReaderService.readFile(GitHub raw + 커밋별 Redis 7일 캐시) — Phase 5 도구의 실행부 그대로라 허용 폴더·비밀값 이름 거절도 같다.
 * 조치에 대조할 이름이 하나도 없으면(산문만) 파일을 읽지 않는다 — 네트워크 0, e2e 픽스처('조치 없음')도 GitHub 를 부르지 않는다.
 *
 * 결과 규칙: 이름은 있는데 읽은 파일이 0 → null("대조할 코드 없음") · 이름 0 → checkedCount 0(파일 목록도 빈다) · 그 밖 → 대조 결과.
 * 실패(GitHub 장애·404·상한)는 던지지 않고 그 파일만 뺀다 — 칩이 없어도 카드는 나가야 한다.
 */
@Injectable()
export class IdentifierCheckService {
  private readonly logger = new Logger(IdentifierCheckService.name);

  /** 인시던트당 읽는 파일 상한. 프레임에서 추정한 파일이 많아도 앞의 몇 개가 원인 파일이다 */
  static readonly MAX_FILES_PER_INCIDENT = 6;

  constructor(private readonly sourceReader: SourceReaderService) {}

  async checkMany(inputs: IdentifierCheckInput[]): Promise<Map<number, IdentifierCheckView | null>> {
    const out = new Map<number, IdentifierCheckView | null>();
    if (inputs.length === 0) return out;

    // 이름부터 뽑는다 — 이름이 없는 카드는 파일을 읽을 이유가 없다
    const names = new Map<number, string[]>();
    for (const input of inputs) names.set(input.analysisId, extractIdentifiers(input.suggestedFix ?? ''));

    const groups = new Map<string, IdentifierCheckInput[]>();
    for (const input of inputs) {
      const g = groups.get(input.incidentId) ?? [];
      g.push(input);
      groups.set(input.incidentId, g);
    }

    // 같은 (ref, path) 는 한 번만 읽는다 — 카드 50장이라도 파일은 인시던트 수 × 몇 개
    const fileCache = new Map<string, Promise<{ ok: true; text: string } | { ok: false }>>();
    const readOnce = (ref: string, filePath: string) => {
      const key = `${ref}:${filePath}`;
      let p = fileCache.get(key);
      if (!p) {
        p = this.sourceReader
          .readFile(filePath, ref)
          .then((r) => (r.ok ? ({ ok: true, text: r.text } as const) : ({ ok: false } as const)))
          .catch((e) => {
            this.logger.warn(`이름 대조용 파일 읽기 실패(${filePath}@${ref}): ${(e as Error).message}`);
            return { ok: false } as const;
          });
        fileCache.set(key, p);
      }
      return p;
    };

    await Promise.all(
      [...groups.values()].map(async (group) => {
        const needsFiles = group.some((i) => (names.get(i.analysisId) ?? []).length > 0);
        if (!needsFiles || !this.sourceReader.isEnabled()) {
          // 아무 카드도 이름이 없으면 읽지 않는다. 리더가 꺼져 있으면 이름이 있어도 대조할 수 없다(null)
          for (const input of group) {
            const empty = (names.get(input.analysisId) ?? []).length === 0;
            out.set(input.analysisId, empty ? { checkedFiles: [], checkedCount: 0, unknown: [], maybeLibrary: [] } : null);
          }
          return;
        }

        const ref = IdentifierCheckService.pickRef(group, this.sourceReader.getDefaultRef());
        const files = IdentifierCheckService.pickFiles(group);
        const results = await Promise.all(files.map((f) => readOnce(ref, f)));
        const texts: string[] = [];
        const checkedFiles: string[] = [];
        const shortRef = SourceReaderService.COMMIT_REF.test(ref) ? ref.slice(0, 7) : ref;
        results.forEach((r, idx) => {
          if (r.ok) {
            texts.push(r.text);
            checkedFiles.push(`${files[idx]}@${shortRef}`);
          }
        });

        for (const input of group) {
          if ((names.get(input.analysisId) ?? []).length === 0) {
            // 이름이 없는 카드도 같은 인시던트의 파일 목록을 받는다 — 두 팔의 checkedFiles 가 다르면 그것이 새 누수다
            out.set(input.analysisId, { checkedFiles, checkedCount: 0, unknown: [], maybeLibrary: [] });
            continue;
          }
          if (texts.length === 0) {
            out.set(input.analysisId, null);
            continue;
          }
          const r = findUnknownIdentifiers(input.suggestedFix ?? '', texts);
          out.set(input.analysisId, { checkedFiles, checkedCount: r.checked.length, unknown: r.unknown, maybeLibrary: r.maybeLibrary });
        }
      }),
    );
    return out;
  }

  /** 읽는 커밋 — 메모 코드의 ref → tool_calls 의 첫 성공 ref → 기본 브랜치. 인시던트 단위로 하나 */
  static pickRef(group: IdentifierCheckInput[], defaultRef: string): string {
    for (const i of group) if (i.noteCodeRef?.trim()) return i.noteCodeRef.trim();
    for (const i of group) {
      const hit = (i.toolCalls ?? []).find((c) => c && c.ok && typeof c.ref === 'string' && c.ref.trim());
      if (hit) return hit.ref.trim();
    }
    return defaultRef;
  }

  /** 대조 파일 — 메모 코드 파일 먼저, 그다음 카드 순서대로 relatedFiles. 읽을 수 있는 꼴만(checkPath), 중복 제거, 상한 */
  static pickFiles(group: IdentifierCheckInput[]): string[] {
    const seen = new Set<string>();
    const files: string[] = [];
    const push = (p: unknown) => {
      if (typeof p !== 'string' || files.length >= IdentifierCheckService.MAX_FILES_PER_INCIDENT) return;
      // `main.ts:65` 처럼 줄 번호가 붙은 프레임 문자열은 떼고 본다
      const clean = p.replace(/:\d+(?::\d+)?$/, '');
      const checked = SourceReaderService.checkPath(clean);
      if (!checked.ok || seen.has(checked.path)) return;
      seen.add(checked.path);
      files.push(checked.path);
    };
    for (const i of group) push(i.noteCodePath);
    for (const i of group) for (const f of i.relatedFiles ?? []) push(f);
    return files;
  }
}
