"use client";

import {useState,SyntheticEvent} from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/apiClient";

export default function LoginPage(){
    const {login} = useAuth();
    const router = useRouter();

    const [email,setEmail]=useState("");
    const [password,setPassword]=useState("");
    const [error,setError]= useState<string|null>(null);
    const [submitting,setSubmitting] = useState(false);

    async function handleSubmit (e:SyntheticEvent<HTMLFormElement>){
        e.preventDefault();
        setError(null);
        setSubmitting(true);

        try{
            await login(email,password);
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
            <h1>Login</h1>
            <form onSubmit={handleSubmit}>
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
                    {submitting ? "Logging in..." : "Login"}
                </button>
            </form>

            <p>
                No account? <a href="/register">Register</a>
            </p>
        </div>
    );

}