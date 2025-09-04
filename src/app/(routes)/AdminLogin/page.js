"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FaUser, FaLock, FaSpinner, FaEye, FaEyeSlash } from "react-icons/fa";
import { useAuth } from "@/context/AuthContext";

const AdminLogin = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [usernameFocused, setUsernameFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [error, setError] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [blogsLoading, setBlogsLoading] = useState(false);

  const router = useRouter();
  const { login } = useAuth();

  // API Configuration - Separate backends
  const API_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5002"; // Blogs backend
  const API_BASE_URL_MAIN = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001"; // Dashboard backend

  // Check for existing session on component mount
  useEffect(() => {
    if (typeof window === "undefined") return; // Guard for SSR
    
    try {
      const token = localStorage.getItem("adminToken");
      if (!token) return;

      const roleRaw = localStorage.getItem("adminRole") || "";
      const role = String(roleRaw).toLowerCase();
      const path = 
        role === "superadmin" || role === "admin" 
          ? "/superadmin/dashboard" 
          : "/dashboard";

      router.push(path);
    } catch {
      // Ignore storage access errors
    }
  }, [router]);

  const shouldFloatLabel = (value, isFocused) => {
    return value.length > 0 || isFocused;
  };

  // Safe error message extraction to prevent unhandled JSON parsing
  const extractErrorMessage = async (response) => {
    try {
      const raw = await response.text();
      if (!raw) return `HTTP ${response.status}: Login failed`;

      try {
        const jsonData = JSON.parse(raw);
        return jsonData?.message || `HTTP ${response.status}: Login failed`;
      } catch {
        // If it's not JSON, return the raw text or default message
        return raw.length > 100 ? `HTTP ${response.status}: Login failed` : raw;
      }
    } catch {
      return `HTTP ${response.status}: Login failed`;
    }
  };

  // DASHBOARD LOGIN implementation
  const loginToDashboard = async () => {
    if (!process.env.NEXT_PUBLIC_API_URL) {
      setError("API URL is not configured.");
      return;
    }

    const res = await fetch(`${API_BASE_URL_MAIN}/api/admin-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Dashboard expects { username, password }
      body: JSON.stringify({ username, password }),
    });

    // Parse JSON body for both success and error paths
    let data = null;
    try {
      data = await res.json();
    } catch {
      // If body isn't JSON, fall back to status-based error extraction
    }

    if (!res.ok) {
      const fallback = data?.message || `HTTP ${res.status}: Admin login failed`;
      throw new Error(fallback);
    }

    if (!data?.token) {
      throw new Error("Invalid response structure from server - missing token");
    }

    // Persist minimal admin session context
    try {
      localStorage.setItem("adminToken", data.token);
      localStorage.setItem("adminRole", data.role);
      localStorage.setItem("adminUsername", data.username || "");
      localStorage.setItem("adminEmail", data.email || "");
      localStorage.setItem("adminId", data.id || "");
      localStorage.setItem("isAdminLoggedIn", "true");

      // Namespaced dashboard keys (avoid collisions with blogs)
      localStorage.setItem("dashboardToken", data.token);
      localStorage.setItem("dashboardRole", String(data.role || "").toLowerCase());
      localStorage.setItem(
        "dashboardUser",
        JSON.stringify({
          token: data.token,
          role: String(data.role || "user").toLowerCase(),
          username: data.username,
          email: data.email || "",
          id: data.id,
          source: "dashboard",
          lastLogin: data.lastLogin || new Date().toISOString(),
        })
      );
    } catch {
      // If storage fails (e.g., privacy mode), proceed to redirect anyway
    }

    // Optional: update AuthContext if available
    if (login) {
      login({
        token: data.token,
        role: String(data.role || "user").toLowerCase(),
        username: data.username,
        email: data.email || "",
        id: data.id,
        source: "dashboard",
        lastLogin: data.lastLogin || new Date().toISOString(),
      });
    }

    // Role-based redirect: SuperAdmin/Admin -> /superadmin/dashboard, else -> /dashboard
    const roleLower = String(data.role || "").toLowerCase();
    const redirectPath =
      roleLower === "superadmin" || roleLower === "admin" ? "/superadmin/dashboard" : "/dashboard";
    router.replace(redirectPath);
  };

  const handleSubmit = async (e, targetPage) => {
    e.preventDefault();
    setError(null);

    // Validation
    if (!username.trim() || !password.trim()) {
      setError("Username and password are required");
      return;
    }

    // Set the appropriate loading state based on target page
    if (targetPage === "/dashboard") {
      setDashboardLoading(true);
    } else if (targetPage === "/blog-admin") {
      setBlogsLoading(true);
    }

    try {
      if (targetPage === "/dashboard") {
        // If already logged in, just route based on stored role
        if (typeof window !== "undefined") {
          const existing = localStorage.getItem("adminToken");
          if (existing) {
            const role = String(localStorage.getItem("adminRole") || "").toLowerCase();
            const path =
              role === "superadmin" || role === "admin"
                ? "/superadmin/dashboard"
                : "/dashboard";
            router.push(path);
            return;
          }
        }

        // Otherwise, run the existing dashboard login flow
        await loginToDashboard();
      } else if (targetPage === "/blog-admin") {
        // BLOGS flow (unchanged)
        const apiUrl = `${API_BASE_URL}/api/auth/login`;
        const requestBody = { loginIdentifier: username, password };
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorMessage = await extractErrorMessage(response);
          throw new Error(errorMessage);
        }

        const data = await response.json();
        if (!data.token) {
          throw new Error("Invalid response structure from server - missing token");
        }

        const userData = {
          token: data.token,
          role: (data.role || "user").toLowerCase(),
          username: data.username,
          email: data.email || "",
          id: data.id,
          isActive: data.active !== false,
          lastLogin: data.lastLogin || new Date().toISOString(),
          source: "blogs",
        };

        const validRoles = ["admin", "user", "superadmin"];
        if (!validRoles.includes(userData.role)) {
          throw new Error(`Invalid role: ${userData.role} for this login type`);
        }

        // Namespaced storage for blogs + generic keys
        localStorage.setItem("blogsToken", userData.token);
        localStorage.setItem("blogsRole", userData.role);
        localStorage.setItem("blogsUser", JSON.stringify(userData));

        localStorage.setItem("adminToken", userData.token);
        localStorage.setItem("adminRole", userData.role);
        localStorage.setItem("adminUsername", userData.username);
        localStorage.setItem("adminEmail", userData.email || "");
        localStorage.setItem("adminId", userData.id || "");
        localStorage.setItem("isAdminLoggedIn", "true");
        localStorage.setItem("userData", JSON.stringify(userData));

        // Hard redirect to ensure full re-init of blog admin context
        window.location.href = "/blog-admin";
        return;
      }
    } catch (err) {
      setError(err?.message || "An error occurred during login");
    } finally {
      setDashboardLoading(false);
      setBlogsLoading(false);
    }
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    handleSubmit(e, "/dashboard");
  };

  return (
    <section
      className="flex justify-center items-center min-h-screen w-full bg-cover bg-center bg-no-repeat"
      style={{
        backgroundImage: `url('https://img.freepik.com/premium-vector/background-night-mountains-whimsical-cartoon-illustration-night-mountains_198565-8267.jpg')`,
      }}
    >
      <div className="relative w-full max-w-sm md:max-w-md bg-transparent backdrop-filter backdrop-blur-md border border-wheat text-yellow-100 flex flex-col justify-center items-center text-center rounded-3xl p-6 md:p-8 min-h-[400px]">
        <form onSubmit={handleFormSubmit} className="w-full">
          {/* Heading */}
          <h2 className="text-2xl font-bold text-center mb-6 text-yellow-100 text-shadow-sm">
            Admin Log-In
          </h2>

          {/* Error Message */}
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4 text-sm">
              <strong>Error:</strong> {error}
            </div>
          )}

          {/* Username/Email Input */}
          <div className="relative mx-auto mb-6 w-full border-b-2 border-yellow-100 text-shadow">
            <FaUser className="absolute right-3 top-1/2 transform -translate-y-1/2 text-xl text-yellow-100" />
            <input
              type="text"
              name="username"
              id="admin_username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onFocus={() => setUsernameFocused(true)}
              onBlur={() => setUsernameFocused(false)}
              required
              autoComplete="username"
              className="w-full h-12 bg-transparent border-none outline-none text-base px-3 pr-10 text-yellow-100 placeholder-transparent"
            />
            <label
              htmlFor="admin_username"
              className={`absolute left-0 text-base pointer-events-none transition-all duration-300 ${
                shouldFloatLabel(username, usernameFocused)
                  ? "-top-2 text-sm text-shadow-none"
                  : "top-1/2 transform -translate-y-1/2"
              }`}
            >
              Username or Email
            </label>
          </div>

          {/* Password Input with Show/Hide Toggle */}
          <div className="relative mx-auto mb-8 w-full border-b-2 border-yellow-100 text-shadow">
            <FaLock className="absolute right-3 top-1/2 transform -translate-y-1/2 text-xl text-yellow-100" />
            <input
              type={showPassword ? "text" : "password"}
              name="password"
              id="login_password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setPasswordFocused(true)}
              onBlur={() => setPasswordFocused(false)}
              required
              autoComplete="current-password"
              className="w-full h-12 bg-transparent border-none outline-none text-base px-3 pr-16 text-yellow-100 placeholder-transparent"
            />
            <label
              htmlFor="login_password"
              className={`absolute left-0 text-base pointer-events-none transition-all duration-300 ${
                shouldFloatLabel(password, passwordFocused)
                  ? "-top-2 text-sm text-shadow-none"
                  : "top-1/2 transform -translate-y-1/2"
              }`}
            >
              Password
            </label>
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              className="absolute right-10 top-1/2 transform -translate-y-1/2 text-xl text-yellow-100 p-1 focus:outline-none hover:text-yellow-200 transition-colors"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <FaEyeSlash /> : <FaEye />}
            </button>
          </div>

          {/* Submit Buttons */}
          <div className="flex flex-col items-center gap-4 w-full">
            {/* Dashboard Login Button */}
            <button
              type="button"
              onClick={(e) => handleSubmit(e, "/dashboard")}
              disabled={dashboardLoading || blogsLoading}
              className="w-4/5 h-11 rounded-full bg-orange-700 text-white text-lg font-semibold border-none outline-none cursor-pointer shadow-md hover:shadow-xl hover:bg-orange-800 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center"
            >
              {dashboardLoading ? (
                <>
                  <FaSpinner className="animate-spin mr-2" />
                  Logging In...
                </>
              ) : (
                "Login to Dashboard"
              )}
            </button>

            {/* Blog Admin Login Button */}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                handleSubmit(e, "/blog-admin");
              }}
              disabled={blogsLoading || dashboardLoading}
              className="w-4/5 h-11 rounded-full bg-blue-600 text-white text-lg font-semibold border-none outline-none cursor-pointer shadow-md hover:shadow-xl hover:bg-blue-700 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center"
            >
              {blogsLoading ? (
                <>
                  <FaSpinner className="animate-spin mr-2" />
                  Logging In...
                </>
              ) : (
                "Login to Blog Admin"
              )}
            </button>
          </div>

          {/* Role Information */}
          <div className="mt-4 text-xs text-yellow-200 opacity-75 text-center">
            <p>All users can access blog administration</p>
            <p>Permissions are managed inside the system</p>
          </div>

          {/* Connection Status (Development Only) */}
          {process.env.NODE_ENV === "development" && (
            <div className="mt-2 text-xs text-yellow-200 opacity-50 text-center">
              <div>Dashboard API: {API_BASE_URL_MAIN}</div>
              <div>Blogs API: {API_BASE_URL}</div>
            </div>
          )}
        </form>
      </div>
    </section>
  );
};

export default AdminLogin;
