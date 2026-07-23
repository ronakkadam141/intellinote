const API_URL = process.env.NEXT_PUBLIC_API_URL;

if(!API_URL){
    console.warn("NEXT_PUBLIC_API_URL is not set, check .env.local");
}

export class ApiError extends Error{
    code:string;
    status:number;

    constructor(message: string, code:string, status:number){
        super(message);
        this.name ="ApiError";
        this.code =code;
        this.status = status;
    }
}

type ApiSuccess<T> = {
    success : true;
    data:T;
};

type ApiFailure = { 
    success:false; 
    error:{
        code:string;
        message:string;
    }
};

type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

interface RequestOptions extends Omit<RequestInit,"body">{
    body?:unknown;
}

async function request<T>(path:string, options:RequestOptions = {}):Promise<T>{
    const token = typeof window!== "undefined" ? localStorage.getItem("token") :null;
    
    const headers :HeadersInit ={
        "Content-Type": "application/json",
        ...(token?{Authorization:`Bearer ${token}`}:{}),
        ...options.headers,
    }

    const res = await fetch(`${API_URL}${path}`,{
        ...options,
        headers,
        body:options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    let json : ApiResponse<T>;

    try{
        json = await res.json();
    }
    catch{
        throw new ApiError("Couldn't reach server.","NETWORK_ERROR",res.status||0);
    }

    if(!json.success){
        throw new ApiError(json.error.message, json.error.code,res.status);
    }

    return json.data;
}

export const apiClient = {
    get: <T>(path:string) => request<T>(path,{method:"GET"}),
    post: <T>(path:string,body?:unknown) => request<T>(path,{method:"POST",body}),
    patch: <T>(path:string,body?:unknown) => request<T>(path,{method:"PATCH",body}),
    delete: <T>(path:string) => request<T>(path,{method:"DELETE"}),
}
