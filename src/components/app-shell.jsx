import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";

export function AppShell({
    children,
    pathname = "#/dashboard"
}) {
	return (
		<SidebarProvider>
			<AppSidebar pathname={pathname} />
			<SidebarInset className="p-4 md:p-6">
				<AppHeader pathname={pathname} />
				<div className="flex flex-1 flex-col gap-4">{children}</div>
			</SidebarInset>
		</SidebarProvider>
	);
}
