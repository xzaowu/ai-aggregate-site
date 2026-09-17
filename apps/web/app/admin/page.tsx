import { redirect } from "next/navigation";
import {
  defaultAdminSection,
  getAdminSectionHref
} from "./admin-navigation";

export default function AdminRootPage() {
  redirect(getAdminSectionHref(defaultAdminSection));
}
