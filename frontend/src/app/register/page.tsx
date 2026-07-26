"use client";

import {useState,SyntheticEvent} from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/apiClient";

export default function RegisterPage(){
    const {register} = useAuth();
    const router = useRouter();

    const [email,setEmail]=useState("");
    const [password,setPassword]=useState("");
    const [displayName, setDisplayName] = useState("");
    const [error,setError]= useState<string|null>(null);
    const [submitting,setSubmitting] = useState(false);

    async function handleSubmit (e:SyntheticEvent<HTMLFormElement>){
        e.preventDefault();
        setError(null);
        setSubmitting(true);

        try{
            await register(email,password,displayName||undefined);
            router.push("/workspaces");
        }
        catch(err){
            if(err instanceof ApiError){
                setError(err.message);
            }
            else{
                setError("Something went wrong. Please try again.")
            }
        }
        
        finally{
            setSubmitting(false);
        }
    }

    return (
        <div>
            <h1>Register</h1>
            <form onSubmit={handleSubmit}>
                <div>
                    <label htmlFor="displayName">Name (optional)</label>
                    <input id="displayName" type="text" value={displayName} onChange={(e)=>setDisplayName(e.target.value)} />
                </div>

                <div>
                    <label htmlFor="email">Email</label>
                    <input id="email" type="email" value={email} onChange={(e)=>setEmail(e.target.value)} required />
                </div>

                <div>
                    <label htmlFor="password">Password</label>
                    <input id="password" type="password" value={password} onChange={(e)=>setPassword(e.target.value)} required />
                </div>

                {error && <p style={{color:"red"}}>{error}</p>}

                <button type="submit" disabled={submitting}>
                    {submitting ? "Creating account..." : "Register"}
                </button>
            </form>

            <p>
                Already have an account? <a href="/login">Login</a>
            </p>
        </div>
    );

}