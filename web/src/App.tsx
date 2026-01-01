import "./App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
//import Summary from "./pages/Summary";
import Support from "./pages/Support";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Subscribe from "./pages/Subscribe";
import { BillingProvider } from "./billing/BillingProvider";
import RequireSubscription from "./routes/RequireSubscription";

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
              <RequireSubscription>
                <Support />
              </RequireSubscription>
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
          <Route path="/subscribe" element={<Subscribe />} />
        </Routes>
      </BrowserRouter>
    </BillingProvider>
  );
}

export default App;
