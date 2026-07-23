"use client";

import {createContext, useContext, useEffect, useState, ReactNode} from "react";
import {apiClient} from "@/lib/apiClient";
import type { User,AuthResponse} from "@/types/auth";

interface AuthContextValue{
    user:User|null;
    loading:boolean;
    login:(email:string, password:string)=> Promise<void>;
    register:(email:string,password:string,displayName?:string) =>Promise<void>;
    logout:()=> void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({children} : {children :ReactNode}){
    const [user,setUser] = useState<User |null>(null);
    const [loading , setLoading] = useState(true);

    useEffect (()=>{
        let cancelled = false;
        async function checkAuth (){
            const token = localStorage.getItem("token");
            if(!token){
                if(!cancelled) setLoading(false);
                return;
            }

            try{
                const {user} = await apiClient.get<{user:User}>("/api/auth/me");
                if(!cancelled) setUser(user);
            }
            catch{
                localStorage.removeItem("token");
                if(!cancelled) setUser(null);
            }
            finally{
                if(!cancelled) setLoading(false);
            }
        }

        checkAuth();

        return ()=>{
            cancelled=true;
        }

    },[]);

    async function login(email:string,password:string){
        const data = await apiClient.post<AuthResponse>("/api/auth/login",{email,password});
        localStorage.setItem("token",data.token);
        setUser(data.user);
    }

    async function register(email:string, password:string, displayName?:string){
        const data= await apiClient.post<AuthResponse>("/api/auth/register",{
            email,
            password,
            displayName,
        });
        localStorage.setItem("token",data.token);
        setUser(data.user);
    }

    function logout(){
        localStorage.removeItem("token");
        setUser(null);
    }

    return (
        <AuthContext.Provider value={{user,loading,login,register,logout}}>{children}</AuthContext.Provider>
    );
}

export function useAuth(){
    const ctx = useContext(AuthContext);
    if(!ctx) throw new Error ("useAuth must be used inside an AuthProvider");
    return ctx;
}