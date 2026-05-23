// Worker entry stub. The actual implementation lives in
// `shared/client/pose-worker-impl.ts` and is reused by the fps app. This
// stub exists so Vite's worker-chunk bundler has access to this app's
// `node_modules` when resolving the impl's deps (notably
// `@mediapipe/tasks-vision`) — the shared tree has no node_modules of
// its own.
import '@shared/client/pose-worker-impl';
