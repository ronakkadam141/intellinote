interface PopulatedUser{
    _id:string;
    displayName: string | null;
    avatarUrl : string | null;
}

export interface DocumentSummary{
    id: string;
    title: string;
    workspaceId: string;
    folderId: string | null;
    isPinned: boolean;
    tags: string[];
    createdBy: string | PopulatedUser;
    lastEditedBy: string | PopulatedUser;
    createdAt: string;
    updatedAt: string;
}