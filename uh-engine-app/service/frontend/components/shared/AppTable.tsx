import React from 'react';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type TableColumn<T> = {
    key: keyof T;
    header: string;
    className?: string;
};

type Density = 'comfortable' | 'compact';

type AppTableProps<T> = {
    columns: Array<TableColumn<T>>;
    rows: Array<T>;
    caption?: string;
    getRowKey?: (row: T, index: number) => string | number;
    isLoading?: boolean;
    error?: string;
    density?: Density;
};

export const AppTable = <T extends Record<string, unknown>>({
    columns,
    rows,
    caption,
    getRowKey,
    isLoading,
    error,
    density = 'comfortable',
}: AppTableProps<T>) => {
    const cellPadding = density === 'compact' ? 'px-2 py-1' : 'px-3 py-2';

    return (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
            <Table className="min-w-full text-left">
                {caption ? <TableCaption>{caption}</TableCaption> : null}
                <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                        {columns.map((c) => (
                            <TableHead key={String(c.key)} className={`font-medium ${cellPadding} ${c.className ?? ''}`}>
                                {c.header}
                            </TableHead>
                        ))}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {isLoading ? (
                        <TableRow>
                            <TableCell colSpan={columns.length} className={`${cellPadding} text-muted-foreground`}>
                                Loading...
                            </TableCell>
                        </TableRow>
                    ) : error ? (
                        <TableRow>
                            <TableCell colSpan={columns.length} className={`${cellPadding} text-destructive`}>
                                {error}
                            </TableCell>
                        </TableRow>
                    ) : rows.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={columns.length} className={`${cellPadding} text-muted-foreground`}>
                                No data available
                            </TableCell>
                        </TableRow>
                    ) : (
                        rows.map((row, i) => (
                            <TableRow key={String(getRowKey ? getRowKey(row, i) : i)} className="odd:bg-muted/30 hover:bg-muted/50">
                                {columns.map((c) => (
                                    <TableCell key={String(c.key)} className={`${cellPadding} ${c.className ?? ''}`}>
                                        {String(row[c.key] ?? '')}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))
                    )}
                </TableBody>
            </Table>
        </div>
    );
};
