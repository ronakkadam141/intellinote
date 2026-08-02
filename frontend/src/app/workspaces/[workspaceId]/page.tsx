"use client";

import { useEffect,useState,SyntheticEvent, act } from "react";
import { useParams,useSearchParams } from "next/navigation";
import RequireAuth from "@/components/RequireAuth";
import { apiClient,ApiError } from "@/lib/apiClient";
import type { DocumentSummary } from "@/types/document";
import type { Folder } from "@/types/folder";

function WorkspaceHomeContent(){
    const {workspaceId} = useParams<{workspaceId : string}>();
    const searchParams = useSearchParams();
    const activeFolderId = searchParams.get("folderId");
    const [folders,setFolders]= useState<Folder[]>([]);
    const [documents,setDocuments]= useState<DocumentSummary[]>([]);
    const [loading,setLoading]= useState(true)
    const [error,setError]= useState<string | null>(null);

    
    const [newFolderName,setNewFolderName]= useState("");
    const [newDocTitle,setNewDocTitle]= useState("");
    const [creatingFolder,setCreatingFolder]= useState(false);
    const [creatingDoc,setCreatingDoc]= useState(false);

    useEffect(() =>{
        let cancelled=false;

        Promise.all([
            apiClient.get<{folders:Folder[]}>(`/api/workspaces/${workspaceId}/folders`),
            apiClient.get<{documents:DocumentSummary[]}>(`/api/workspaces/${workspaceId}/documents?folderId=${activeFolderId ?? "root"}`),
        ])
        .then(([folderRes,docRes]) =>{
            if(!cancelled){
                setFolders(folderRes.folders);
                setDocuments(docRes.documents);
            }
        })
        .catch((err)=>{
            if(!cancelled){
                setError(err instanceof ApiError ? err.message : "Failed to load workspace.");
            }
        })
        .finally(()=>{
            if (!cancelled) setLoading(false);
        });

        return () =>{
            cancelled=true;
        };

    },[workspaceId,activeFolderId]);
    
    async function handleCreateFolder (e: SyntheticEvent<HTMLFormElement>){
        e.preventDefault();
        setCreatingFolder(true);
        setError(null);

        try{
            const {folder} = await apiClient.post<{folder:Folder}>(`/api/workspaces/${workspaceId}/folders`,{name:newFolderName});

            setFolders((prev)=>[...prev,folder]);
            setNewFolderName("");
        }
        catch(err){
            setError(err instanceof ApiError ? err.message : "Failed to create folder.");
        }
        finally{
            setCreatingFolder(false);
        }
    }

    async function handleCreateDocument(e: SyntheticEvent<HTMLFormElement>){
        e.preventDefault();
        setCreatingDoc(true);
        setError(null);

        try{
            const {document} = await apiClient.post<{document:DocumentSummary}>(`/api/workspaces/${workspaceId}/documents`,{title:newDocTitle});

            setDocuments((prev) => [...prev,document]);
            setNewDocTitle("");
        }
        catch(err){
            setError(err instanceof ApiError ? err.message : "Failed to create document.");
        }
        finally{
            setCreatingDoc(false);
        }
    }

    if(loading) return <p>Loading workspace...</p>;

    return (
        <div>
            <h1>Workspace</h1>
            {error && <p style={{color:"red"}}>{error}</p>}

            <h2>Folders</h2>
            {folders.length===0 ? (
                <p>No folders yet.</p>
            ):(
                <ul>
                    {folders.map((f)=>(
                        <li key ={f.id}>
                            <a href={`/workspaces/${workspaceId}?folderId={f.id}`}>📁 {f.name}</a> 
                        </li>
                    ))}
                </ul>
            )}
            <form onSubmit={handleCreateFolder}>
                <input 
                    type="text"
                    placeholder="New Folder Name"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    required
                />
                <button type="submit" disabled={creatingFolder}>
                    {creatingFolder ? "Creating..." : "Create Folder"}
                </button>
            </form>
            
            {activeFolderId && (
                <p>
                    <a href={`/workspaces/${workspaceId}`}>Back To root</a>
                </p>
            )}
            <h2>Documents</h2>
            {documents.length === 0 ? (
                <p>No documents at root level yet.</p>
            ) : (
                <ul>
                    {documents.map((d)=>(
                        <li key={d.id}> 📄 {d.title} {d.isPinned && "📌"}</li>
                    ))}
                </ul>
            )}

            <form onSubmit={handleCreateDocument}>
                <input 
                    type="text"
                    placeholder="New doument title"
                    value={newDocTitle}
                    onChange={(e)=>setNewDocTitle(e.target.value)}
                    required
                />
                <button type ="submit" disabled={creatingDoc}>{creatingDoc ? "Creating..." : "Create document"}</button>
            </form>
        </div>
    );
}

export default function WorkspaceHomePage(){
    return (
        <RequireAuth>
            <WorkspaceHomeContent/>
        </RequireAuth>
    );
}
