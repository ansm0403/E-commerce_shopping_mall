import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { emptyHumanReview, summarizeHumanReview } from './answer-review';
import type { AnswerReviewReport, HumanAnswerReview } from './answer-review';

function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !/^--(report|review|notes|judge)=.+$/.test(arg)) || new Set(args.map(arg => arg.split('=')[0])).size !== args.length) throw new Error('INVALID_ARGUMENTS');
  const value = (name: string) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const input = value('report'); if (!input) throw new Error('REPORT_REQUIRED');
  const raw = readFileSync(resolve(input), 'utf8'); const report = JSON.parse(raw) as AnswerReviewReport;
  if (!Array.isArray(report.cases) || report.cases.some(item => !item.caseId || !item.question)) throw new Error('INVALID_REPORT');
  const sha256 = createHash('sha256').update(raw).digest('hex');
  const reviewFile = value('review');
  if (reviewFile) {
    const summary = summarizeHumanReview(report, JSON.parse(readFileSync(resolve(reviewFile), 'utf8')) as HumanAnswerReview, sha256);
    console.log(JSON.stringify(summary)); if (!summary.complete) process.exitCode = 1; return;
  }
  const notes = value('notes') ? JSON.parse(readFileSync(resolve(value('notes')!), 'utf8')) as Record<string, unknown> : {};
  if (notes._sourceReportSha256 && notes._sourceReportSha256 !== sha256) throw new Error('NOTES_REPORT_MISMATCH');
  const judge = value('judge') ? JSON.parse(readFileSync(resolve(value('judge')!), 'utf8')) as { cases: { caseId: string }[] } : null;
  const pending = emptyHumanReview(report, sha256);
  const data = { report, pending, notes, judge, source: basename(input), sha256 };
  const directory = join(__dirname, '../results'); mkdirSync(directory, { recursive: true });
  const prefix = join(directory, `search-answer-review-${basename(input, '.json')}`);
  const template = `${prefix}.json`; if (!existsSync(template)) writeFileSync(template, JSON.stringify(pending, null, 2) + '\n');
  const payload = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>최종 답변 원문 대조</title>
<style>body{font:15px/1.65 system-ui;margin:0;color:#17212b;background:#f3f5f7}header{padding:24px;background:#173546;color:white}main{max-width:1050px;margin:24px auto;padding:0 18px}section{background:white;padding:24px;border-radius:12px;margin:20px 0}pre{white-space:pre-wrap;word-break:break-word;background:#f4f6f8;padding:16px}button,input,select,textarea{font:inherit;padding:8px;margin:4px}textarea{width:95%;height:70px}label{display:block}nav{display:flex;flex-wrap:wrap;gap:4px}.done{background:#d5eddd}.failed{background:#ffe0df}.pending{background:#eee}small{display:block;color:#526474}h2{font-size:20px}#status{font-weight:bold}</style>
<header><h1>최종 답변 원문 대조</h1><p>에이전트 의견·모델 보조 판정과 사람 판정을 구분합니다. 모든 문항은 미검토로 시작합니다.</p></header>
<main><section><label>검토자 이름 <input id="reviewer" autocomplete="off"></label><button id="download">사람 판정 JSON 저장</button><label>이전 판정 이어서 열기 <input id="import" type="file" accept="application/json"></label><p id="status"></p><small id="source"></small></section><nav id="nav"></nav><section id="case"></section></main>
<script id="data" type="application/json">${payload}</script><script>
const data=JSON.parse(document.getElementById('data').textContent);let review=structuredClone(data.pending),index=0;
const labels={conditions:'상품·기간·상태 조건',evidence:'원문 ID·인용·필수 사실',polarity:'긍정·부정 및 제목·본문·답변 구분',noUnsupportedClaims:'자료에 없는 주장 없음',stateExplanation:'근거 없음·색인 대기·장애 구분'};
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rowState=row=>Object.values(row.checks).some(v=>v===null)||!row.reason.trim()?'pending':Object.values(row.checks).every(Boolean)?'done':'failed';
function render(){const item=data.report.cases[index],row=review.entries[index];document.getElementById('nav').innerHTML=review.entries.map((r,i)=>'<button class="'+rowState(r)+'" data-index="'+i+'">'+(i+1)+'</button>').join('');document.querySelectorAll('[data-index]').forEach(b=>b.onclick=()=>{index=Number(b.dataset.index);render()});document.getElementById('status').textContent='계획 '+data.report.planned+' / 실행 '+data.report.executed+' / 사람 검토 '+review.entries.filter(r=>rowState(r)!=='pending').length+' / 최종 성공률은 검증 CLI 확인 후 확정';document.getElementById('source').textContent=data.source+' | SHA256 '+data.sha256;const calls=item.executedTools??item.trace?.toolCalls??[];document.getElementById('case').innerHTML='<h2>'+(index+1)+'. '+escape(item.caseId)+'</h2><h3>질문</h3><p>'+escape(item.question)+'</p><h3>정답 조건</h3><pre>'+escape(JSON.stringify(item.expected,null,2))+'</pre><h3>실제 답변</h3><pre>'+escape(item.trace?.reply??'완료된 답변 없음: '+item.errorCode)+'</pre><h3>에이전트 대조 의견 — 사람 판정 아님</h3><pre>'+escape(JSON.stringify(data.notes[item.caseId]??'미작성',null,2))+'</pre><details><summary>실제 도구 인자·반환 원문 펼치기</summary><pre>'+escape(JSON.stringify(calls,null,2))+'</pre></details><details><summary>기존 모델 보조 판정 펼치기</summary><pre>'+escape(JSON.stringify(data.judge?.cases.find(r=>r.caseId===item.caseId)??'없음',null,2))+'</pre></details><h3>사람 판정</h3>'+Object.entries(labels).map(([key,label])=>'<label>'+label+' <select data-key="'+key+'"><option value="pending">미검토</option><option value="true">통과</option><option value="false">실패</option></select></label>').join('')+'<label>판정 이유<textarea id="reason"></textarea></label><button id="pass">원문 대조 완료 — 다섯 기준 모두 통과</button><button id="next">다음 문항</button>';document.querySelectorAll('[data-key]').forEach(select=>{select.value=row.checks[select.dataset.key]===null?'pending':String(row.checks[select.dataset.key]);select.onchange=()=>{row.checks[select.dataset.key]=select.value==='pending'?null:select.value==='true';}});document.getElementById('reason').value=row.reason;document.getElementById('reason').oninput=e=>row.reason=e.target.value;document.getElementById('pass').onclick=()=>{if(item.errorCode||!item.trace){alert('실행에 실패한 문항은 통과로 판정할 수 없습니다.');return}Object.keys(labels).forEach(key=>row.checks[key]=true);row.reason=row.reason.trim()||'검토자가 질문·실제 도구 조건·원문·답변을 대조하여 다섯 기준을 확인했습니다.';render()};document.getElementById('next').onclick=()=>{index=Math.min(index+1,review.entries.length-1);render()};}
document.getElementById('download').onclick=()=>{review.reviewer=document.getElementById('reviewer').value.trim();if(!review.reviewer){alert('검토자 이름을 입력해주세요.');return}review.reviewedAt=new Date().toISOString();const blob=new Blob([JSON.stringify(review,null,2)+'\\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='human-review-'+data.source;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
document.getElementById('import').onchange=async event=>{try{const incoming=JSON.parse(await event.target.files[0].text());if(incoming.sourceReportSha256!==data.sha256||incoming.entries.length!==data.pending.entries.length||incoming.entries.some((row,i)=>row.caseId!==data.pending.entries[i].caseId))throw Error();review=incoming;document.getElementById('reviewer').value=review.reviewer;render()}catch{alert('이 보고서의 판정 JSON인지 확인해주세요.')}};render();
</script></html>`;
  writeFileSync(`${prefix}.html`, html + '\n');
  console.log(JSON.stringify({ html: `${prefix}.html`, reviewTemplate: template, planned: report.planned, executed: report.executed, humanReviewPending: report.planned, finalAnswerSuccessRate: null, apiRequests: 0 }));
}
try { main(); } catch (error) { console.error(error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'ANSWER_REVIEW_FAILED'); process.exitCode = 1; }
