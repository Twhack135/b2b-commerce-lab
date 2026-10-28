import { redirect } from "next/navigation";

// Materials is the only module so far, so it is the start page
export default function Home() {
  redirect("/materials");
}
