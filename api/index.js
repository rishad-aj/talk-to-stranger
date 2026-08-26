// Vercel serves this file at the route "/api" (the client posts to "/api").
// It re-exports the handler from app.js (which also remains reachable at "/api/app").
export { default } from "./app.js";
