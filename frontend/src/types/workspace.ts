export interface Workspace {
    id:string;
    name:string; 
    description:string;
    slug:string;
    role:"owner"|"editor"|"viewer";
    joinedAt?:string;
    createdAt?:string;
}