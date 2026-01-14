import "./App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
//import Summary from "./pages/Summary";
import Support from "./pages/Support";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Subscribe from "./pages/Subscribe";
import InstamojoReturn from "./pages/InstamojoReturn";
import Admin from "./pages/Admin";
import { BillingProvider } from "./billing/BillingProvider";
import RequireSubscription from "./routes/RequireSubscription";
import RequireAdmin from "./components/RequireAdmin";
import RequireAuth from "./components/RequireAuth";

function App() {
  return (
    <BillingProvider>
      <BrowserRouter>
        <Routes>
          {/* Landing page – full custom layout */}
          <Route path="/" element={<Home />} />

          <Route
            path="/dashboard"
            element={
              <RequireSubscription>
                <Dashboard />
              </RequireSubscription>
            }
          />

          {/*<Route path="/summary" element={<Summary />} />*/}
          <Route
            path="/support"
            element={
              <RequireAuth>
                <Support />
              </RequireAuth>
            }
          />
          <Route path="/login" element={<Login />} />
          <Route
            path="/signup"
            element={
              <RequireSubscription>
                <Signup />
              </RequireSubscription>
            }
          />
          <Route
            path="/persona"
            element={
              <RequireSubscription>
                <Signup />
              </RequireSubscription>
            }
          />
          <Route
            path="/billing/instamojo/return"
            element={<InstamojoReturn />}
          />
          <Route
            path="/admin"
            element={
              <RequireAdmin>
                <Admin />
              </RequireAdmin>
            }
          />
          <Route path="/subscribe" element={<Subscribe />} />
        </Routes>
      </BrowserRouter>
    </BillingProvider>
  );
}

export default App;
