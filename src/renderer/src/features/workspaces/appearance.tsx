import {
  BookOpen,
  Briefcase,
  Code2,
  FlaskConical,
  GraduationCap,
  Heart,
  House,
  Layers,
  Rocket,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { WorkspaceColor, WorkspaceIcon } from '@shared/workspace';
import { cn } from '@renderer/lib/cn';

export const workspaceColors: Record<WorkspaceColor, { hex: string; label: string }> = {
  violet: { hex: '#8b5cf6', label: 'Violeta' },
  blue: { hex: '#3b82f6', label: 'Azul' },
  teal: { hex: '#14b8a6', label: 'Turquesa' },
  green: { hex: '#22c55e', label: 'Verde' },
  amber: { hex: '#f59e0b', label: 'Âmbar' },
  orange: { hex: '#f97316', label: 'Laranja' },
  rose: { hex: '#f43f5e', label: 'Rosa' },
  slate: { hex: '#64748b', label: 'Grafite' },
};

export const workspaceIcons: Record<WorkspaceIcon, { Icon: LucideIcon; label: string }> = {
  layers: { Icon: Layers, label: 'Camadas' },
  briefcase: { Icon: Briefcase, label: 'Trabalho' },
  wallet: { Icon: Wallet, label: 'Finanças' },
  code: { Icon: Code2, label: 'Código' },
  home: { Icon: House, label: 'Casa' },
  book: { Icon: BookOpen, label: 'Estudos' },
  flask: { Icon: FlaskConical, label: 'Experimentos' },
  rocket: { Icon: Rocket, label: 'Projetos' },
  heart: { Icon: Heart, label: 'Pessoal' },
  graduation: { Icon: GraduationCap, label: 'Formação' },
};

export function WorkspaceAvatar({
  color,
  icon,
  size = 'sm',
}: {
  color: WorkspaceColor;
  icon: WorkspaceIcon;
  size?: 'xs' | 'sm' | 'lg';
}) {
  const { Icon } = workspaceIcons[icon];
  const hex = workspaceColors[color].hex;
  const dims = { xs: 'size-5 rounded-md', sm: 'size-6 rounded-md', lg: 'size-10 rounded-xl' }[size];
  const iconSize = { xs: 12, sm: 14, lg: 20 }[size];
  return (
    <span
      aria-hidden
      className={cn('grid shrink-0 place-items-center', dims)}
      style={{ backgroundColor: `${hex}26`, color: hex, boxShadow: `inset 0 0 0 1px ${hex}40` }}
    >
      <Icon size={iconSize} />
    </span>
  );
}
