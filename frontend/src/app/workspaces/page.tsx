"use client";

import { useEffect,useState,SyntheticEvent } from "react"; 
import RequireAuth from "@/components/RequireAuth";
import { apiClient,ApiError } from "@/lib/apiClient";
import type { Workspace } from "@/types/workspace";

function WorkspaceContent(){
    const [workspaces,setWorkspaces] = useState<Workspace[]>([]);
    const [loading,setLoading] = useState(true);
    const [error,setError] = useState<string | null>(null);

    const [name,setName] = useState("");
    const [description,setDescription] = useState("");
    const [creating,setCreating]=useState(false);

    useEffect(()=>{
        let cancelled=false;

        apiClient
            .get<{workspaces:Workspace[]}>("/api/workspaces")
            .then(({workspaces})=>{
                if(!cancelled) setWorkspaces(workspaces);
            })
            .catch((err) =>{
                if(!cancelled){
                    setError(err instanceof ApiError? err.message : "Failed to load workspaces.");
                }
            })
            .finally(()=>{
                if(!cancelled) setLoading(false);
            });
        
            return ()=>{
                cancelled=true;
            };
    },[]);

    async function handleCreate(e: SyntheticEvent<HTMLFormElement>){
        e.preventDefault();
        setCreating(true);
        setError(null);

        try{
            const {workspace}= await apiClient.post<{workspace:Workspace}>("/api/workspaces",{
                name,
                description,
            });
            setWorkspaces((prev)=>[...prev,workspace]);
            setName("")
            setDescription("")
        }

        catch(err){
            setError(err instanceof ApiError ? err.message : "Failed to create workspace.");
        }

        finally{
            setCreating(false);
        }
    }

    if(loading) return <p>Loading workspaces...</p>

    return (
        <div>
            <h1>Your workspaces</h1>

            {error && <p style={{color:'red'}}>{error}</p>}

            {workspaces.length === 0 ?(
                <p>You dont have any workspaces yet.</p>
            ):(
                <ul>
                    {workspaces.map((ws)=>(
                        <li key = {ws.id}>
                            <a href={`/workspaces/${ws.id}`}>{ws.name}</a> - {ws.role}
                        </li>
                    ))}
                </ul>
            )}

            <h2>Create A workspace</h2>

            <form onSubmit={handleCreate}>
                <div>
                    <label htmlFor="name">Name</label>
                    <input 
                        id='name'
                        type="text"
                        value={name}
                        onChange={(e)=>setName(e.target.value)}
                        required
                    />
                </div>
                <div>
                    <label htmlFor="description">Description</label>
                    <input 
                        id="description"
                        type="text"
                        value={description}
                        onChange={(e)=>setDescription(e.target.value)}
                    />
                </div>

                <button type="submit" disabled={creating}>
                    {creating ? "Creating..." : "Create workspace"}
                </button>
            </form>
        </div>
    );
}

export default function WorkspacePage(){
    return (
        <RequireAuth>
            <WorkspaceContent />
        </RequireAuth>
    );
}