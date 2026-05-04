import { BaseModel } from "../base.model.js";
import { Review } from "../review/review.js";
import { WishList } from "../wishList/wishList.js";

export interface User extends BaseModel {
    email: string;
    password: string;
    name: string;
    phoneNumber: string;
    address: string;
    roles: ('buyer' | 'seller' | 'admin')[];
    wishList?: WishList;
}

export type UserWithReviews = User & {
    reviews?: Review[];
}

export interface UserProfileResponse extends Omit<User, 'password' | 'wishList'> {
    nickName: string;
    isEmailVerified: boolean;
    isDemo: boolean;
}

export interface UpdateProfileRequest {
    nickName?: string;
    phoneNumber?: string;
    address?: string;
}

export interface ChangePasswordRequest {
    currentPassword: string;
    newPassword: string;
}
