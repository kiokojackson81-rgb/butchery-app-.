import { redirect } from "next/navigation";

// Server component to redirect to the consolidated Admin Ops tab with the History sub-tab
export default function Page() {
  redirect("/admin?tab=ops&opsTab=history");
}
