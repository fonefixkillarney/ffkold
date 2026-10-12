import AuthLayout from "@/app/components/layout/AuthLayout";

// backdrop="plain" opts the admin login OUT of the glassy backdrop the
// storefront sign-up / reset screens now use: this screen is part of the
// dashboard the client already signed off, so it keeps its flat surface.
export default function AdminLoginLayout({ children }) {
  return <AuthLayout backdrop="plain">{children}</AuthLayout>;
}
