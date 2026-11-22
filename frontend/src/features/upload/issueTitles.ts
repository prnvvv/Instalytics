/** Short headings for each kind of parser notice. Notices themselves never contain usernames or file contents. */
export const ISSUE_TITLE: Record<string, string> = {
  invalid_json: 'A file could not be read',
  unexpected_structure: 'A file has an unexpected layout',
  file_too_large: 'A file was too large to read',
  html_export: 'This is an HTML export',
  no_connection_files: 'No followers or following files found',
  missing_followers_file: 'No followers file',
  missing_following_file: 'No following file',
  missing_part: 'Part of the followers or following list is missing',
  rejected_records: 'Some records could not be read',
  possible_date_range_limit: 'This export may be limited to a date range',
  empty_list: 'An empty list',
  conflicting_usernames: 'Records with conflicting usernames',
  duplicate_source_files: 'The same file appears more than once'
}
