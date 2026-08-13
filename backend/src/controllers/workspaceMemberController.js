// req.workspaceMember is already attached by requireWorkspaceAccess middleware —
// this controller just echoes it back. No separate DB query needed, since
// the membership lookup already happened in middleware and we don't want a
// second, parallel implementation of the same logic.
async function getMyMembership(req, res, next) {
    try {
        const { userId, workspaceId, role } = req.workspaceMember;

        return res.status(200).json({
            success: true,
            data: { userId, workspaceId, role },
        });
    } catch (err) {
        return next(err);
    }
}

module.exports = { getMyMembership };