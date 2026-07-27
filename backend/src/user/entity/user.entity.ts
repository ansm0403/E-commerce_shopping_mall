import type { CartEntity } from "../../cart/entity/cart.entity";
import { BaseModel } from "../../common/entity/base.entity";
import { Column, Entity, JoinTable, ManyToMany, OneToMany, OneToOne } from "typeorm";
import type { ReviewEntity } from "../../review/entity/review.entity";
import { RoleEntity } from "./role.entity";
import { Exclude } from "class-transformer";

@Entity('users')
export class UserModel extends BaseModel {
    @Column()
    email: string;

    // 직렬화에서만 제외 — 로그인 시 bcrypt 비교는 엔티티 인스턴스를 직접 읽으므로 영향 없다.
    // (relations:['user'] 로 유저를 통째로 싣는 응답에서 해시가 새어나가는 것을 원천 차단)
    @Exclude()
    @Column()
    password: string;

    @Column()
    nickName: string;

    @Column()
    phoneNumber: string;

    @Column()
    address: string;

    @Column({ default: false })
    isEmailVerified: boolean;

    @Column({ name: 'is_demo', default: false })
    isDemo: boolean;

    @ManyToMany(() => RoleEntity, { eager: false })
    @JoinTable({
        name: 'user_roles',
        joinColumn: { name: 'user_id', referencedColumnName: 'id' },
        inverseJoinColumn: { name: 'role_id', referencedColumnName: 'id' },
    })
    roles: RoleEntity[];

    @OneToOne('CartEntity', 'user')
    cart: CartEntity;

    @OneToMany('ReviewEntity', (review: any) => review.user)
    reviews: ReviewEntity[];
}
