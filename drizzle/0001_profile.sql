ALTER TABLE profiles ADD COLUMN tagline TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE profiles ADD COLUMN bio TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE profiles ADD COLUMN title TEXT NOT NULL DEFAULT '街の住人';
--> statement-breakpoint
ALTER TABLE profiles ADD COLUMN accent TEXT NOT NULL DEFAULT '#2e6b54';
--> statement-breakpoint
ALTER TABLE profiles ADD COLUMN avatar_icon TEXT NOT NULL DEFAULT 'leaf';
--> statement-breakpoint
ALTER TABLE profiles ADD COLUMN show_name INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE profiles ADD COLUMN profile_version INTEGER NOT NULL DEFAULT 0;
