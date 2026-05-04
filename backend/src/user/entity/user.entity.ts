import type { CartEntity } from "../../cart/entity/cart.entity";
import { BaseModel } from "../../common/entity/base.entity";
import { Column, Entity, JoinTable, ManyToMany, OneToMany, OneToOne } from "typeorm";
import type { ReviewEntity } from "../../review/entity/review.entity";
import { RoleEntity } from "./role.entity";

@Entity('users')
export class UserModel extends BaseModel {
    @Column()
    email: string;

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
