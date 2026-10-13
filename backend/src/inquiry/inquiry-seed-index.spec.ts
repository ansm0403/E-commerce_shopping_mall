import { InquirySeedService } from '../seed/inquiry.seed.service';
import { InquiryEntity } from './entity/inquiry.entity';
import { SearchIndexRecorder } from '../search/search-index-recorder';

describe('inquiry seed source/job transaction', () => {
  const source = { count: jest.fn(), create: jest.fn(), manager: { transaction: jest.fn() } };
  const saved = { save: jest.fn() };
  const products = { find: jest.fn() };
  const manager = { getRepository: jest.fn() };
  const recorder = { recordInquiry: jest.fn() };
  let seed: InquirySeedService;

  beforeEach(() => {
    jest.resetAllMocks();
    source.count.mockResolvedValue(0);
    source.create.mockImplementation(value => value);
    products.find.mockResolvedValue([{ id: 10, sellerId: 7 }]);
    saved.save.mockImplementation(values => values.map((value: InquiryEntity, index: number) => ({ ...value, id: index + 1 })));
    manager.getRepository.mockReturnValue(saved);
    source.manager.transaction.mockImplementation(callback => callback(manager));
    seed = new InquirySeedService(source as never, products as never, recorder as unknown as SearchIndexRecorder);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('records generated sources using the same transaction without constructing a model client', async () => {
    await seed.seedInquiries([1], [7]);
    expect(source.manager.transaction).toHaveBeenCalledTimes(1);
    expect(saved.save).toHaveBeenCalledTimes(1);
    expect(recorder.recordInquiry).toHaveBeenCalledTimes(13);
    for (const [transaction, id] of recorder.recordInquiry.mock.calls) {
      expect(transaction).toBe(manager);
      expect(id).toBeGreaterThan(0);
    }
    expect(saved.save.mock.invocationCallOrder[0]).toBeLessThan(recorder.recordInquiry.mock.invocationCallOrder[0]);
    expect(saved.save.mock.calls[0][0].filter((item: InquiryEntity) => item.isSecret)).toHaveLength(2);
  });

  it('propagates a registration failure rather than accepting a partially registered batch', async () => {
    recorder.recordInquiry.mockRejectedValue(new Error('PROFILE_MISMATCH'));
    await expect(seed.seedInquiries([1], [7])).rejects.toThrow('PROFILE_MISMATCH');
  });

  it('preserves the idempotent skip when generated buyer inquiries already exist', async () => {
    source.count.mockResolvedValue(13);
    await seed.seedInquiries([1], [7]);
    expect(source.manager.transaction).not.toHaveBeenCalled();
    expect(recorder.recordInquiry).not.toHaveBeenCalled();
  });
});
