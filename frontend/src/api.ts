import axios from "axios";

const fromEnv = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const baseURL = fromEnv ? `${fromEnv}/api` : "/api";

const api = axios.create({
  baseURL,
  headers: { "Content-Type": "application/json" }
});

export default api;
