"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function RequireAuth({children}:{children:React.ReactNode}){
    const {user,loading} = useAuth();
    const router = useRouter();

    useEffect(()=>{
        if(!loading && user){
            router.push("/workspaces");
        }
    },[loading,user,router]);

    if (loading){
        return <p>Loading...</p>;
    }

    if(user){
        return null;
    }

    return <>{children}</>;
}