export interface User{
    id:string;
    email:string,
    displayName:string | null;
    avatarUrl : string | null;
    createdAt?: string;
}

export interface AuthResponse{
    token:string;
    user:User;
}