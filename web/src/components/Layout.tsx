import type { ReactNode } from "react";
import Navbar from "./Navbar";

export default function Layout({ children, phone }: { children: ReactNode; phone?: string | null }) {
  return (
    <>
      <Navbar phone={phone} />
      <div className="container page">{children}</div>
    </>
  );
}
