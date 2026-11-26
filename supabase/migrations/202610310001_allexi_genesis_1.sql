-- User-supplied Allexi Genesis 1. Combined 4–5 and 11–12 are split at clause boundaries.
-- Null actors identify this owner-applied content import, not a fictitious account.
alter table public.scripture_drafts alter column updated_by drop not null;
alter table public.scripture_history alter column actor_id drop not null;

-- Only new rows are published: preserve all existing drafts and publications.
with supplied(verse,text) as (values
(1,'At the start, the lord created the heaven and the earth.'),
(2,'that earth was shapeless and void ;and the spirit of the lord moved upon the darkness of the earth.'),
(3,'and the lord said,let there be light: and light was.'),
(4,'and the lord was pleased with the light, and divided the light from the dark.'),
(5,'Then he let it shine for a while, and then it darkened again. He called the light day,” and the dark night. “  so then the first day was formed.'),
(6,'and the lord said again,” vapors separate and form the sky up from the oceans below.'),
(7,'that’s how the lord made the sky, by separating the vapors from the waters.'),
(8,'the lord called the sky heaven, so then this happened on the second day.'),
(9,'the lord said.  Let the waters beneath the sky be concentrated unto one,so the dry land emerge.”And it was so.'),
(10,'father named the dry land earth; and the waters he then called”seas “.  And he was pleased.'),
(11,'again father said. Earth burst forward with all sort of seed bearing plant,grass, and fruit trees with seeds,'),
(12,'and the fruit tree bearing fruit after his kind, and so it was.'),
(13,'this all happened on the third day.'),
(14,'the lord said,light should be in the sky to brighten the earth so that the day and the night should get  their identity.'),
(15,'that’s the start of seasons on earth and days and years. “ that was so.'),
(16,'the lord made two huge lights, that’s the sun and the moon to shine,the biggest light the sun should rule over the day and the small one the moon should shine over the night; and he also made the stars.'),
(17,'The lord put them in the sky to light the earth,'),
(18,'so they could rule over the day and the night, to separate the light from the dark. Father was satisfied.'),
(19,'this took place on the fourth day.'),
(20,'father again said. Waters bring forth fish and other creatures that has life, and the skies should be filled with birds of all kinds.'),
(21,'so the lord created sea creatures, and all sorts of fish and every kind of bird.  The Lord saw it to be good.'),
(22,'and blessed them all.  Demanding that they be fruitful, and multiply,to fill the waters of the seas, and to the birds he said,”increase your numbers. And fill the earth.'),
(23,'this was on the fifth day.'),
(24,'the lord said, earth bring forth all kind of animals,cattle, and creeping thing, and wildlife of every kind. So it was.'),
(25,'father made every sorts of wild animals in their kind,cattle and reptiles of their kind. And the Lord was pleased with the job.'),
(26,'the Lord said,let us make man, and he should be like us and has our look. Let them be lord over all life on earth, birds in the skies and fish of the seas, the reptiles of the earth, and wildlife as well.'),
(27,'so the lord created man like his maker.
As God he make him God.
Man and woman he made them.'),
(28,'the lord blessed them, and said to them you are fruitful,multiply yourselves and fill the earth and subdue it. You are the Lord of the fish of the sea, the fowl of the air, the animals of the land and over every living thing.'),
(29,'says the lord, I have given unto you the seed bearing plants upon the earth, all the fruit trees for your well being.'),
(30,'all the grass and plants for the animals and birds for their food.'),
(31,'the lord saw everything has made to be perfect in every angle. All ended on the sixth day.')
), imported as (
  insert into public.scripture_drafts(edition,book,chapter,verse,text,status,revision,updated_by)
  select 'allexi',0,1,verse,text,'updated',1,null from supplied
  on conflict(edition,book,chapter,verse) do nothing
  returning *
), published as (
  insert into public.scripture_publications(edition,book,chapter,verse,text,revision)
  select edition,book,chapter,verse,text,revision from imported
  returning *
), history as (
  insert into public.scripture_history(edition,book,chapter,verse,action,after_text,status,revision,actor_id)
  select edition,book,chapter,verse,'publish',text,'updated',revision,null from published
  returning id
)
update public.scripture_settings
set default_edition=case when revision=0 then 'allexi' else default_edition end,
    revision=revision+1
where id and exists(select 1 from history);
