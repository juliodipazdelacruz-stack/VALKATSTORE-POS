"use client";;
import { useId, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import { formatChartAxisTick, formatChartTooltipDate } from "@/components/formater";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Delta, DeltaIcon, DeltaValue } from "@/components/delta";
import { revenueChartDemo } from "@/components/revenue-chart-data";
import { ArrowRightIcon } from "lucide-react";

// Recharts XAxis: `interval` is tick skip index (0 = all, 1 = every other, …).
const xAxisIntervalByPeriod = {
	7: 0,
	14: 1,
	30: 3,
	60: 4,
	90: 6,
};

const chartConfig = {
    revenue: {
		label: "Revenue",
		color: "var(--chart-1)",
	}
};

export function RevenueChart() {
	const chartUid = useId().replace(/:/g, "");
	const idAreaGradient = `revenue-area-grad-${chartUid}`;
	const [periodDays, setPeriodDays] = useState(60);

	const chartRows = useMemo(
		() => revenueChartDemo.slice(-periodDays),
		[periodDays]
	);

	// Footer delta: first → last point in the active series (not calendar MoM).
	const growthPct = useMemo(() => {
		const first = chartRows[0]?.revenue ?? 0;
		const last = chartRows.at(-1)?.revenue ?? first;
		if (!first) {
			return 0;
		}
		return ((last - first) / first) * 100;
	}, [chartRows]);

	// Extra spacing so long ranges don’t collide; pairs with `interval` above.
	let xAxisMinTickGap;
	if (periodDays <= 7) {
		xAxisMinTickGap = undefined;
	} else {
		xAxisMinTickGap = Math.max(8, Math.min(52, Math.floor(periodDays / 2)));
	}

	return (
        <Card className="md:col-span-2 lg:col-span-4">
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<CardTitle className="text-balance">Revenue</CardTitle>
				<Select
					onValueChange={(v) => {
						setPeriodDays(Number(v));
					}}
					value={String(periodDays)}
				>
					<SelectTrigger
						aria-label="Revenue time range"
						className="w-full min-w-36 sm:w-fit"
						size="sm"
					>
						<SelectValue placeholder="Range" />
					</SelectTrigger>
					<SelectContent align="end">
						<SelectItem value="7">Last 7 days</SelectItem>
						<SelectItem value="14">Last 14 days</SelectItem>
						<SelectItem value="30">Last 30 days</SelectItem>
						<SelectItem value="60">Last 60 days</SelectItem>
						<SelectItem value="90">Last 90 days</SelectItem>
					</SelectContent>
				</Select>
			</CardHeader>
            <CardContent>
				<ChartContainer
					className="aspect-auto h-60 w-full p-0"
					config={chartConfig}
				>
					<AreaChart
						accessibilityLayer
						// Copy so Recharts always sees a mutable array reference.
						data={[...chartRows]}
						margin={{ left: 24, right: 8, top: 8, bottom: 0 }}
					>
						<defs>
							<linearGradient id={idAreaGradient} x1="0" x2="0" y1="0" y2="1">
								<stop
									offset="0%"
									stopColor="var(--color-revenue)"
									stopOpacity={0.2}
								/>
								<stop
									offset="100%"
									stopColor="var(--color-revenue)"
									stopOpacity={0}
								/>
							</linearGradient>
						</defs>
						<CartesianGrid horizontal={false} strokeDasharray="2 2" />
						<XAxis
							axisLine={false}
							dataKey="date"
							interval={xAxisIntervalByPeriod[periodDays]}
							minTickGap={xAxisMinTickGap}
							tickFormatter={(value) =>
								formatChartAxisTick(String(value), periodDays)
							}
							tickLine={false}
							tickMargin={8}
						/>
						<ChartTooltip
							content={
								<ChartTooltipContent
									className="min-w-36"
									indicator="line"
									labelFormatter={(_, payload) => {
										const row = payload?.[0]?.payload;
										if (!row?.date) {
											return "";
										}
										return formatChartTooltipDate(row.date, "short");
									}}
								/>
							}
						/>
						<Area
							dataKey="revenue"
							dot={false}
							fill={`url(#${idAreaGradient})`}
							stroke="var(--color-revenue)"
							strokeWidth={2}
							type="monotone"
						/>
					</AreaChart>
				</ChartContainer>
			</CardContent>
            <CardFooter className="flex items-center justify-between">
				<div className="flex items-center gap-1 text-muted-foreground text-xs">
					<Delta value={growthPct}>
						<DeltaIcon />
						<DeltaValue />
					</Delta>
					<p className="inline-flex text-pretty">
						vs first day in last {periodDays} days.
					</p>
				</div>
				<Button className="text-muted-foreground" size="xs" variant="ghost" render={<a href="#/reports" />} nativeButton={false}>View report
                						<ArrowRightIcon aria-hidden="true" data-icon="inline-end" /></Button>
			</CardFooter>
        </Card>
    );
}
