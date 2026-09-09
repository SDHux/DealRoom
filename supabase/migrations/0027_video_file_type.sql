-- Adds a distinct 'video' file type for Zoom recording links pasted into a deal's content
-- section. Recording links open directly (like 'link' rows do) rather than embedding --
-- Zoom's playback pages set X-Frame-Options and won't render inside an iframe.
alter table documents drop constraint documents_file_type_check;
alter table documents add constraint documents_file_type_check
  check (file_type in ('pptx', 'xlsx', 'pdf', 'docx', 'image', 'link', 'video'));
