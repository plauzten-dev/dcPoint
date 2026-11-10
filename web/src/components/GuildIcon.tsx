import { memo } from 'react';
import { guildAcronym, guildIconUrl } from '../lib/cdn';
import { cn } from '../lib/cn';

export const GuildIcon = memo(function GuildIcon({ guild, size = 48, className }: { guild: { id: string; name: string; icon: string | null }; size?: number; className?: string }) {
  const url = guildIconUrl(guild);
  if (url) return <img src={url} alt="" width={size} height={size} draggable={false} className={cn('object-cover', className)} style={{ width: size, height: size }} />;
  const acronym = guildAcronym(guild.name);
  return (
    <div
      className={cn("flex items-center justify-center bg-chat font-medium text-text", className)}
      style={{ width: size, height: size, fontSize: acronym.length > 3 ? size * 0.25 : size * 0.33 }}
    >
      {acronym}
    </div>
  );
});
