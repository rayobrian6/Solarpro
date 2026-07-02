-- Capture-time device GPS for survey photos.
-- The SurveyV2 photo step now samples navigator.geolocation when a photo is
-- taken (browser file-input photos carry no EXIF GPS — confirmed on Melvin's
-- surveys). The surveyor stands within a few meters of the subject, so a
-- meter/main-panel photo GPS pins the equipment to the correct wall.
-- Consumed by the permit route to build surveyPhotoHints → PV-1 equipment
-- markers with 'PER SURVEY PHOTO GPS' provenance (equipmentLocator tier 1,
-- which shipped 2026-07-02 but had no data source until now).

ALTER TABLE site_survey_files
  ADD COLUMN IF NOT EXISTS gps_lat double precision;

ALTER TABLE site_survey_files
  ADD COLUMN IF NOT EXISTS gps_lng double precision;

ALTER TABLE site_survey_files
  ADD COLUMN IF NOT EXISTS gps_accuracy_m real;
