import { DataSource } from 'typeorm';
import { UserModel } from '../../user/entity/user.entity';
import { Role, RoleEntity } from '../../user/entity/role.entity';
import { SellerEntity, SellerStatus } from '../../seller/entity/seller.entity';

/** Called only with the independently created integration-test schema. */
export async function seedCatalogOwner(ds: DataSource) {
  const roles = await ds.getRepository(RoleEntity).find();
  const user = await ds.getRepository(UserModel).save({
    email: process.env.TEST_SELLER_EMAIL || 'seller1@seed.com',
    password: 'Unused catalog fixture password',
    roles: roles.filter((role) => [Role.BUYER, Role.SELLER].includes(role.name)),
    nickName: 'Catalog owner',
    phoneNumber: '010-0000-0000',
    address: 'Fixture address',
    isDemo: false,
    isEmailVerified: true,
  });
  return ds.getRepository(SellerEntity).save({
    userId: user.id,
    status: SellerStatus.APPROVED,
    businessName: 'Catalog store',
    businessNumber: 'CATALOG-TEST',
    representativeName: 'Catalog owner',
    businessAddress: 'Fixture address',
    bankName: 'Fixture bank',
    bankAccountNumber: '0000000',
    bankAccountHolder: 'Catalog owner',
  });
}
