import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { ChevronRightIcon } from "lucide-react";

export function NavGroup({
    label,
    items,
    pathname
}) {
	return (
		<SidebarGroup>
			{label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
			<SidebarMenu>
				{items.map((item) => (
					<Collapsible className="group/collapsible" defaultOpen={
                    							item.path === pathname ||
                    							item.subItems?.some((subItem) => subItem.path === pathname)
                    						} key={item.title} render={<SidebarMenuItem />}>{item.subItems?.length ? (
                    								<>
                    									<CollapsibleTrigger render={<SidebarMenuButton isActive={item.path === pathname} />}>{item.icon}<span>{item.title}</span><ChevronRightIcon className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" /></CollapsibleTrigger>
                    									<CollapsibleContent>
                    										<SidebarMenuSub>
                    											{item.subItems?.map((subItem) => (
                    												<SidebarMenuSubItem key={subItem.title}>
                    													<SidebarMenuSubButton isActive={subItem.path === pathname} render={<a href={subItem.path} />}>{subItem.icon}<span>{subItem.title}</span></SidebarMenuSubButton>
                    												</SidebarMenuSubItem>
                    											))}
                    										</SidebarMenuSub>
                    									</CollapsibleContent>
                    								</>
                    							) : (
                    								<SidebarMenuButton isActive={item.path === pathname} render={<a href={item.path} />}>{item.icon}<span>{item.title}</span></SidebarMenuButton>
                    							)}</Collapsible>
				))}
			</SidebarMenu>
		</SidebarGroup>
	);
}
