import { Navigate, Route, Routes } from "react-router-dom";

import { ProductApp } from "./features/app/ProductApp";
import { DemoDashboard } from "./features/demo/DemoDashboard";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/demo/" replace />} />
      <Route path="/demo/*" element={<DemoDashboard />} />
      <Route path="/app/*" element={<ProductApp />} />
      <Route path="*" element={<Navigate to="/demo/" replace />} />
    </Routes>
  );
}

export default App;
