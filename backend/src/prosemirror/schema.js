const { getSchema } = require('@tiptap/core');
const StarterKit = require('@tiptap/starter-kit').default;

// Must mirror the frontend's extensions array exactly
// (frontend/.../DocumentEditorPage.tsx) or contentJSON round-trips will
// break. Collaboration is a Yjs-sync extension only — it doesn't add
// nodes/marks, so it's intentionally omitted here.
const extensions = [
    StarterKit.configure({ undoRedo: false }),
];

const schema = getSchema(extensions);

module.exports = { schema };