# MuseMint privacy note

MuseMint collects no personal information and sends no data to a developer-controlled server. It has no analytics, ads, tracking pixels, or remote code.

Playlist data is processed transiently inside the active YouTube Music tab. Hovering over or focusing the split Add control sends a read-only `playlist/get_add_to_playlist` request to YouTube Music so MuseMint can display your playlist names and whether the song is already in each one. The response is held only in memory for that tab. No playlist is changed by opening this chooser.

A track is added to or removed from a playlist only after the user explicitly clicks the relevant control. Add feedback and dislikes are stored only in the browser's extension-local storage so MuseMint can adapt later rankings. Playlist names, playlist contents, and YouTube account identifiers are not written to extension storage.

Preview playback uses an embedded YouTube player and stops automatically after 20 seconds. MuseMint does not operate a preview or recommendation server. It communicates only with YouTube and YouTube Music using the session already active in that tab; it never sends playlist data to the developer or another third party.

The extension requests access only to `music.youtube.com` and browser-local `storage`. Removing it removes its code, UI, and locally stored feedback; it does not remove tracks previously added to playlists.
