import { redirect } from "next/navigation";

// Merged into the home dashboard; kept so old links still land somewhere.
export default function Page() {
  redirect("/");
}
