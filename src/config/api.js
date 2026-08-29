export const API_BASE_URL =
  import.meta.env?.VITE_API_BASE_URL ||
  (typeof window !== "undefined" && window.desktopAPI?.isDesktop
    ? "https://question-bank-api-2vsg.onrender.com"
    : "http://localhost:3002");
