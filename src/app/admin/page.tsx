import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Admin } from "@/components/admin/dashboard";
import { adminSessionId } from "@/lib/admin-session";
import { adminCookie } from "@/lib/security";

export default async function AdminPage() {
  const token = (await cookies()).get(adminCookie())?.value;
  if (!(await adminSessionId(token))) redirect("/admin/login");
  return <Admin />;
}
