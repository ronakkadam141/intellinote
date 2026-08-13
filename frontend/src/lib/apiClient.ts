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

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    const isFormData = options.body instanceof FormData;

    const headers: HeadersInit = {
        // Only force JSON content-type for JSON bodies. For FormData, omit
        // Content-Type entirely so the browser sets its own multipart
        // boundary — setting it manually here breaks file uploads, which is
        // exactly what was causing MISSING_FILE (multer never saw a real
        // multipart body).
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
    };

    const res = await fetch(`${API_URL}${path}`, {
        ...options,
        headers,
        body:
            options.body === undefined
                ? undefined
                : isFormData
                ? (options.body as FormData)
                : JSON.stringify(options.body),
    });

    let json: ApiResponse<T>;

    try {
        json = await res.json();
    } catch {
        throw new ApiError("Couldn't reach server.", "NETWORK_ERROR", res.status || 0);
    }

    if (!json.success) {
        throw new ApiError(json.error.message, json.error.code, res.status);
    }

    return json.data;
}

export const apiClient = {
    get: <T>(path: string): Promise<T> => request<T>(path, { method: "GET" }),
    post: <T>(path: string, body?: unknown): Promise<T> => request<T>(path, { method: "POST", body }),
    patch: <T>(path: string, body?: unknown): Promise<T> => request<T>(path, { method: "PATCH", body }),
    delete: <T>(path: string): Promise<T> => request<T>(path, { method: "DELETE" }),
};