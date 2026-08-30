import WorkspaceSidebar from "@/components/WorkspaceSidebar";

export default async function WorkspaceLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ workspaceId: string }>;
}) {
    const { workspaceId } = await params;
    return (
        <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
            <WorkspaceSidebar workspaceId={workspaceId} />
            <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                {children}
            </div>
        </div>
    );
}