import type { Metadata } from "next";
import { ShopUserManagement } from "@/components/shop-users/shop-user-management";

export const metadata: Metadata = {
  title: "Shop Users",
};

export default function ShopUsersPage() {
  return <ShopUserManagement />;
}
