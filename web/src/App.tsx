import "./App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
//import Summary from "./pages/Summary";
import Support from "./pages/Support";
import Login from "./pages/Login";
import Signup from "./pages/Signup";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Landing page – full custom layout */}
        <Route path="/" element={<Home />} />

        <Route path="/dashboard" element={<Dashboard />} />

        {/*<Route path="/summary" element={<Summary />} />*/}
        <Route
          path="/support"
          element={<Support />}
        />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
