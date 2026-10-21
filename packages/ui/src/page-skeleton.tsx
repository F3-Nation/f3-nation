import { cn } from ".";
import { Card, CardContent, CardFooter, CardHeader } from "./card";
import { Skeleton } from "./skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";

// Mirrors MDTable's toolbar, row count and striped body (md-table.tsx) so the
// page doesn't jump when the real table mounts.
function TableSkeleton({
  rows = 10,
  columns = 5,
}: {
  rows?: number;
  columns?: number;
}) {
  const cols = Array.from({ length: columns }, (_, index) => index);
  return (
    <div role="status" aria-busy="true" className="relative w-full">
      <span className="sr-only">Loading</span>
      <div className="flex items-center justify-between gap-2 py-4">
        <Skeleton className="h-9 w-60" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="pb-2">
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {cols.map((col) => (
                <TableHead key={col}>
                  <Skeleton className="h-4 w-20" />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: rows }, (_, row) => (
              <TableRow
                key={row}
                className={cn({ "bg-muted/20": row % 2 === 0 })}
              >
                {cols.map((col) => (
                  <TableCell key={col} className="p-2">
                    <Skeleton className="h-4" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function FormSkeleton({ fields = 6 }: { fields?: number }) {
  return (
    <Card role="status" aria-busy="true" className="w-full">
      <span className="sr-only">Loading</span>
      <CardHeader>
        <Skeleton className="h-6 w-48" />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {Array.from({ length: fields }, (_, field) => (
          <div key={field} className="flex flex-col gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </CardContent>
      <CardFooter>
        <Skeleton className="h-9 w-24" />
      </CardFooter>
    </Card>
  );
}

export { FormSkeleton, TableSkeleton };
