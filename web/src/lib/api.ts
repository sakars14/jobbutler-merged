import axios from "axios";
import { auth } from "../firebase";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

export const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use(async (cfg) => {
  const u = auth.currentUser;
  if (u) {
    // Send uid so we can make it multi-user later with no frontend change
    cfg.params = { ...(cfg.params || {}), uid: u.uid };
  }
  return cfg;
});
