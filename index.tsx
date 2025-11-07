import React, { useState, useCallback, ChangeEvent, DragEvent, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Type, Modality } from "@google/genai";

interface SoundcloudMetadata {
  genre: string;
  tags: string; // Stays as string for comma-separated values
  description: string;
}

// Predefined list of SoundCloud genres
const SOUNDCLOUD_GENRES = [
  'Alternative Rock', 'Ambient', 'Classical', 'Country', 'Dance & EDM', 'Dancehall', 'Deep House', 
  'Disco', 'Drum & Bass', 'Dubstep', 'Electronic', 'Folk & Singer-Songwriter', 'Hip Hop & Rap', 
  'House', 'Indie', 'Jazz & Blues', 'Latin', 'Metal', 'Piano', 'Pop', 'R&B and Soul', 
  'Reggae', 'Reggaeton', 'Rock', 'Soundtrack', 'Speech', 'Techno', 'Trance', 'Trap', 
  'Triphop', 'World', 'Audiobooks', 'Business', 'Comedy', 'Entertainment', 'Education', 
  'News & Politics', 'Religion & Spirituality', 'Science', 'Sports', 'Storytelling', 'Technology'
];

// Initialize AI outside component to avoid re-initialization on re-renders
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const App: React.FC = () => {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);
  const [trackTitle, setTrackTitle] = useState<string>('');
  const [mainArtist, setMainArtist] = useState<string>('');
  const [genre, setGenre] = useState<string>(''); // Will store selected genre or AI-generated
  const [tags, setTags] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [uploadProgress, setUploadProgress] = useState<number>(0); // Progress for file upload
  const [aiAnalysisProgress, setAiAnalysisProgress] = useState<number>(0); // Progress for AI analysis
  const [isLoading, setIsLoading] = useState<boolean>(false); // General loading state for any background operation
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [trackPrivacy, setTrackPrivacy] = useState<'public' | 'private' | 'schedule'>('public');
  const [trackLink, setTrackLink] = useState<string>('');
  const [isAnalyzingLink, setIsAnalyzingLink] = useState<boolean>(false); // Specific state for link analysis
  const [manualCoverUploadInputKey, setManualCoverUploadInputKey] = useState(Date.now()); // To reset file input
  const [trackType, setTrackType] = useState<'track' | 'live performance' | 'set' | 'unknown'>('unknown');


  // Ref to track if AI is currently updating state, to prevent infinite loops from useEffects
  const isUpdatingFromAI = useRef(false);

  // Memoized function for AI generation
  const generateMetadata = useCallback(async (
    title: string,
    currentGenre: string,
    currentTags: string,
    currentDescription: string,
    shouldGenerateImage: boolean,
    artistName: string = '', // Added artistName for initial setup
    detectedTrackType: 'track' | 'live performance' | 'set' | 'unknown' = 'track' // Added detectedTrackType
  ) => {
    if (!title) {
      // If title is empty, clear everything and do not call AI
      isUpdatingFromAI.current = true; // Temporarily block other effects
      setGenre('');
      setTags('');
      setDescription('');
      // Note: setCoverImageUrl(null) is intentionally omitted here if a manual cover exists.
      // If the intent is for clearing title to also clear manual cover, it should be added.
      // For now, manual cover persists if title is cleared.
      setMainArtist(''); // Clear artist if title is cleared
      isUpdatingFromAI.current = false;
      return;
    }

    setIsLoading(true); // General loading state for AI ops
    setErrorMessage(null);
    setAiAnalysisProgress(0); // Reset AI analysis progress
    isUpdatingFromAI.current = true; // Indicate that state updates are coming from AI

    try {
      // Step 1: Generate metadata text
      setAiAnalysisProgress(20); 
      const trackTypeContext = detectedTrackType !== 'unknown' ? `This is identified as a ${detectedTrackType}.` : '';
      const textPrompt = `You are an expert music metadata generator for SoundCloud. 
          Given the track title '${title}', current genre '${currentGenre}', tags '${currentTags}', and description '${currentDescription}'. ${trackTypeContext}
          Please infer or refine a suitable genre, 5-7 relevant, comma-separated tags including more specific genre sub-categories, moods, and tempos, and an SEO-optimized description (around 150-200 words) that encourages plays. 
          Ensure consistency with provided inputs where appropriate, but also suggest improvements. Output the results in a structured JSON format.
          The description should also include a clear call-to-action at the end, such as 'Listen now!' or 'Stream today!'.`;

      const metadataResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: textPrompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              genre: { 
                type: Type.STRING, 
                description: `The inferred music genre, must be one of: ${SOUNDCLOUD_GENRES.join(', ')}.` 
              },
              tags: { type: Type.STRING, description: '5-7 relevant, comma-separated tags including more specific genre sub-categories, moods, and tempos.' },
              description: { type: Type.STRING, description: 'An SEO-optimized description for SoundCloud, around 150-200 words.' },
            },
            required: ['genre', 'tags', 'description'],
          },
        },
      });

      let jsonStr = metadataResponse.text.trim();
      let metadata: SoundcloudMetadata;
      try {
        metadata = JSON.parse(jsonStr);
      } catch (parseError) {
        console.error("Failed to parse JSON response:", jsonStr, parseError);
        const inferredGenreMatch = jsonStr.match(/"genre"\s*:\s*"([^"]+)"/i);
        const inferredTagsMatch = jsonStr.match(/"tags"\s*:\s*"([^"]+)"/i);
        const inferredDescriptionMatch = jsonStr.match(/"description"\s*:\s*"([^"]+)"/i);

        metadata = {
          genre: inferredGenreMatch && SOUNDCLOUD_GENRES.includes(inferredGenreMatch[1]) ? inferredGenreMatch[1] : (currentGenre && SOUNDCLOUD_GENRES.includes(currentGenre) ? currentGenre : ''), // Fallback to current or empty if invalid
          tags: inferredTagsMatch ? inferredTagsMatch[1] : currentTags || 'music, audio',
          description: inferredDescriptionMatch ? inferredDescriptionMatch[1] : currentDescription || 'A captivating audio track.'
        };
        setErrorMessage('AI response could not be fully parsed as JSON, fallback data was used.');
      }

      setGenre(metadata.genre);
      setTags(metadata.tags);
      setDescription(metadata.description);
      // Set mainArtist if provided during initial call (e.g. from link analysis)
      if (artistName) {
        setMainArtist(artistName);
      }
      setAiAnalysisProgress(60); // Progress after text metadata generation

      // Step 2: Generate image if required
      if (shouldGenerateImage) {
        setAiAnalysisProgress(80); // Progress before image generation
        const imageResponse = await ai.models.generateImages({
          model: 'imagen-4.0-generate-001',
          prompt: `Create a visually striking, abstract, and modern cover image for an audio ${detectedTrackType || 'track'} titled '${title}', suitable for SoundCloud. The image should be 1:1 aspect ratio and reflect a dynamic, perhaps electronic or atmospheric, vibe without being overly literal. Incorporate subtle elements that evoke sound or technology.`,
          config: {
            numberOfImages: 1,
            outputMimeType: 'image/jpeg',
            aspectRatio: '1:1',
          },
        });
        const base64ImageBytes: string = imageResponse.generatedImages[0].image.imageBytes;
        setCoverImageUrl(`data:image/jpeg;base64,${base64ImageBytes}`);
      }
      setAiAnalysisProgress(100); // Analysis complete

    } catch (error: any) {
      console.error('AI generation error:', error);
      setErrorMessage(`AI generation error: ${error.message || 'Unknown error'}. Please try again.`);
      setAiAnalysisProgress(0); // Reset progress on error
    } finally {
      setIsLoading(false);
      isUpdatingFromAI.current = false; // Reset after AI updates are complete
      setIsAnalyzingLink(false); // Reset link analysis state
    }
  }, [setGenre, setTags, setDescription, setCoverImageUrl, setIsLoading, setErrorMessage, setMainArtist, setAiAnalysisProgress]); // Dependencies for useCallback

  // Handler for manual cover image upload
  const handleCoverImageFile = useCallback((file: File) => {
    if (file && file.type.startsWith('image/')) {
      setErrorMessage(null);
      const reader = new FileReader();
      reader.onloadend = () => {
        setCoverImageUrl(reader.result as string);
        setManualCoverUploadInputKey(Date.now()); // Reset input to allow same file upload again
      };
      reader.readAsDataURL(file);
    } else {
      setErrorMessage('Please upload a valid image file (e.g., .jpg, .png) for the cover.');
    }
  }, []);

  const handleCoverImageDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const files = event.dataTransfer.files;
    if (files && files.length > 0) {
      handleCoverImageFile(files[0]);
    }
  }, [handleCoverImageFile]);

  const handleCoverImageFileInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      handleCoverImageFile(files[0]);
    }
  }, [handleCoverImageFile]);

  // Renamed existing handler for audio file upload
  const handleAudioFile = useCallback(async (file: File) => {
    if (file && file.type.startsWith('audio/')) {
      // Reset link-related states when a file is uploaded
      setTrackLink('');
      setIsAnalyzingLink(false);
      setTrackType('unknown'); // Reset track type before new detection

      setAudioFile(file);
      const inferredTitle = file.name.replace(/\.(wav|mp3|flac|aac)$/i, '');
      setTrackTitle(inferredTitle); // Set title immediately
      setUploadProgress(0);
      setAiAnalysisProgress(0); // Reset AI analysis progress
      setErrorMessage(null);
      setIsLoading(true); // Start general loading for upload and analysis

      // Determine track type based on inferred title (simple heuristic)
      let detectedAudioTrackType: 'track' | 'live performance' | 'set' | 'unknown' = 'track';
      const lowerCaseTitle = inferredTitle.toLowerCase();
      if (lowerCaseTitle.includes('live') || lowerCaseTitle.includes('performance')) {
        detectedAudioTrackType = 'live performance';
      } else if (lowerCaseTitle.includes('set') || lowerCaseTitle.includes('mix')) {
        detectedAudioTrackType = 'set';
      }
      setTrackType(detectedAudioTrackType); // Update track type based on audio file

      // Simulate upload progress
      let currentProgress = 0;
      const interval = setInterval(() => {
        currentProgress += 10;
        if (currentProgress <= 100) {
          setUploadProgress(currentProgress);
        } else {
          clearInterval(interval);
          setUploadProgress(100);
          // Initial AI call after "upload" is complete
          // Pass current genre/tags/description to provide context, if any exists (e.g. from a previous upload)
          // Only generate image if no coverImageUrl is currently set (manual upload takes precedence)
          generateMetadata(inferredTitle, genre, tags, description, !coverImageUrl, mainArtist, detectedAudioTrackType); 
        }
      }, 100);

    } else {
      setErrorMessage('Please upload a valid audio file (e.g., .mp3, .wav).');
      setAudioFile(null);
      setUploadProgress(0);
      setAiAnalysisProgress(0);
      setTrackTitle('');
      setMainArtist('');
      setGenre('');
      setTags('');
      setDescription('');
      setIsLoading(false); // End loading if file is invalid
      setTrackType('unknown');
    }
  }, [generateMetadata, genre, tags, description, mainArtist, coverImageUrl, setIsLoading, setUploadProgress, setAiAnalysisProgress]); // Add generateMetadata and other states to dependencies

  // Shared handleDragOver for both image and audio drop zones
  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleAudioFileDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const files = event.dataTransfer.files;
    if (files && files.length > 0) {
      handleAudioFile(files[0]);
    }
  }, [handleAudioFile]);

  const handleAudioFileInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      handleAudioFile(files[0]);
    }
  }, [handleAudioFile]);


  const handleTrackLinkAnalysis = useCallback(async (event: React.FormEvent | React.MouseEvent) => {
    event.preventDefault(); // Prevent page reload if triggered by form submit
    if (!trackLink) {
      setErrorMessage('Please enter a track link.');
      return;
    }

    setIsAnalyzingLink(true);
    setIsLoading(true); // General loading state for AI ops
    setErrorMessage(null);
    setAudioFile(null); // Clear any uploaded file when analyzing a link
    setUploadProgress(0); // Reset progress
    setAiAnalysisProgress(0); // Reset AI analysis progress
    setTrackType('unknown'); // Reset track type before detection

    try {
      // Simulate API call to fetch track metadata from the link
      // In a real app, this would be an actual API call (e.g., to SoundCloud API)
      await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate network delay

      let simulatedTitle = '';
      let simulatedArtist = '';
      let simulatedGenre = '';
      let simulatedTags = '';
      let simulatedDescription = '';
      let detectedType: 'track' | 'live performance' | 'set' | 'unknown' = 'unknown';


      // Simple simulation based on URL content
      if (trackLink.includes('soundcloud.com')) {
        const url = new URL(trackLink);
        const pathSegments = url.pathname.split('/').filter(s => s); // Remove empty strings

        if (pathSegments.includes('sets')) {
          detectedType = 'set';
        } else if (url.pathname.toLowerCase().includes('live') || url.pathname.toLowerCase().includes('performance')) {
          detectedType = 'live performance';
        } else if (pathSegments.length >= 2) {
          detectedType = 'track';
        }
        
        // Extract artist and title (simplified)
        if (pathSegments.length >= 2) {
          simulatedArtist = pathSegments[0].replace(/-/g, ' ').split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
          // For sets, the title might be the last segment before /sets or the actual set name
          if (detectedType === 'set' && pathSegments.length > 2) {
            simulatedTitle = pathSegments[pathSegments.indexOf('sets') - 1].replace(/-/g, ' ').split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
          } else {
            simulatedTitle = pathSegments[1].replace(/-/g, ' ').split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
          }
          
          // Basic heuristic for genre/tags based on title keywords
          if (simulatedTitle.toLowerCase().includes('house')) {
            simulatedGenre = 'House';
            simulatedTags = 'deep house, tech house, summer vibes';
          } else if (simulatedTitle.toLowerCase().includes('hip hop')) {
            simulatedGenre = 'Hip Hop & Rap';
            simulatedTags = 'rap, trap, urban';
          } else {
            simulatedGenre = 'Electronic'; // Default simulated genre
            simulatedTags = 'synth, atmospheric, chill';
          }
          simulatedDescription = `This is an example ${detectedType} by ${simulatedArtist} titled "${simulatedTitle}", based on an analyzed link. The AI will now refine this.`;
        } else {
          simulatedTitle = 'Analyzed Track (Unknown Title)';
          simulatedArtist = 'Unknown Artist';
          simulatedGenre = 'Electronic';
          simulatedTags = 'generated, link, new';
          simulatedDescription = 'A track analyzed via link. The AI will generate further details.';
        }
      } else {
        simulatedTitle = 'Analyzed Track (Unknown Title)';
        simulatedArtist = 'Unknown Artist';
        simulatedGenre = 'World';
        simulatedTags = 'generated, link, new';
        simulatedDescription = 'A track analyzed via link. The AI will generate further details.';
      }
      
      setTrackTitle(simulatedTitle);
      setMainArtist(simulatedArtist); // Set artist from simulated data
      setGenre(simulatedGenre);
      setTags(simulatedTags);
      setDescription(simulatedDescription);
      setTrackType(detectedType); // Set detected track type
      
      // Trigger AI generation with the simulated data
      // Only generate image if no coverImageUrl is currently set (manual upload takes precedence)
      await generateMetadata(simulatedTitle, simulatedGenre, simulatedTags, simulatedDescription, !coverImageUrl, simulatedArtist, detectedType);

    } catch (error: any) {
      console.error('Link analysis error:', error);
      setErrorMessage(`Link analysis error: ${error.message || 'Unknown error'}. Please try again.`);
      setIsLoading(false);
      setIsAnalyzingLink(false);
      setAiAnalysisProgress(0); // Reset AI progress on error
      setTrackType('unknown'); // Reset track type on error
    }
  }, [trackLink, generateMetadata, coverImageUrl, setIsLoading, setIsAnalyzingLink, setAiAnalysisProgress]);


  // Debounced states for user input
  const [debouncedTrackTitle, setDebouncedTrackTitle] = useState(trackTitle);
  const [debouncedOtherMetadataValues, setDebouncedOtherMetadataValues] = useState({ genre, tags, description, mainArtist }); // Include mainArtist in debounced values

  // Effect for debouncing trackTitle changes
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedTrackTitle(trackTitle);
    }, 700); // Debounce time
    return () => clearTimeout(handler);
  }, [trackTitle]);

  // Effect for debouncing other metadata changes
  useEffect(() => {
    const handler = setTimeout(() => {
      // Check if current values are different from the debounced values to avoid unnecessary re-renders
      if (debouncedOtherMetadataValues.genre !== genre || 
          debouncedOtherMetadataValues.tags !== tags || 
          debouncedOtherMetadataValues.description !== description || 
          debouncedOtherMetadataValues.mainArtist !== mainArtist) {
        setDebouncedOtherMetadataValues({ genre, tags, description, mainArtist });
      }
    }, 700); // Debounce time
    return () => clearTimeout(handler);
  }, [genre, tags, description, mainArtist, debouncedOtherMetadataValues]); // Add debouncedOtherMetadataValues for comparison


  // Effect for debouncedTrackTitle changes -> trigger full AI regeneration
  useEffect(() => {
    // Prevent triggering if AI is updating or no audio file/link is present and title is not empty
    // Only trigger if debouncedTrackTitle is actually different from current trackTitle after user input
    if (isUpdatingFromAI.current || (trackTitle === '' && debouncedTrackTitle === '') || isLoading) return;

    if (debouncedTrackTitle !== '') {
      // If title is changed by user, regenerate all metadata.
      // Only generate image if no coverImageUrl is currently set (manual upload takes precedence)
      generateMetadata(debouncedTrackTitle, genre, tags, description, !coverImageUrl, mainArtist, trackType);
    } else {
      // If title is cleared, also clear other generated fields
      isUpdatingFromAI.current = true; // Temporarily block other effects
      setGenre('');
      setTags('');
      setDescription('');
      // If title is cleared, also clear AI generated cover, but not manually uploaded one
      // If the intent is for clearing title to also clear manual cover, setCoverImageUrl(null) should be used.
      // For now, manual cover persists if title is cleared.
      isUpdatingFromAI.current = false;
    }
  }, [debouncedTrackTitle, generateMetadata, genre, tags, description, mainArtist, isLoading, trackTitle, coverImageUrl, trackType]);


  // Effect for debounced other metadata changes -> trigger text AI regeneration only
  useEffect(() => {
    // Prevent triggering if AI is updating, no audio file/link (to provide context for AI), or no track title
    if (isUpdatingFromAI.current || (!audioFile && !trackLink) || !trackTitle || isLoading) return;

    // Trigger AI text generation only if *any* of the debounced metadata values have changed
    if (
      debouncedOtherMetadataValues.genre !== genre ||
      debouncedOtherMetadataValues.tags !== tags ||
      debouncedOtherMetadataValues.description !== description ||
      debouncedOtherMetadataValues.mainArtist !== mainArtist
    ) {
      // Do not generate image when only text metadata changes
      generateMetadata(trackTitle, debouncedOtherMetadataValues.genre, debouncedOtherMetadataValues.tags, debouncedOtherMetadataValues.description, false, debouncedOtherMetadataValues.mainArtist, trackType);
    }
  }, [debouncedOtherMetadataValues, audioFile, trackLink, trackTitle, generateMetadata, genre, tags, description, mainArtist, isLoading, trackType]); // Include all relevant states


  // Handler for downloading the cover image
  const handleDownloadCover = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering the file upload input
    if (coverImageUrl) {
      const link = document.createElement('a');
      link.href = coverImageUrl;
      link.download = `${trackTitle || 'track'}-cover.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }, [coverImageUrl, trackTitle]);

  const coverImageAltText = trackTitle && mainArtist 
    ? `Cover image for ${trackTitle} by ${mainArtist}` 
    : trackTitle 
      ? `Cover image for ${trackTitle}` 
      : 'SoundCloud track cover image';

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-8">
      <div className="flex items-center space-x-2 text-2xl font-bold mb-8 max-w-6xl mx-auto">
        {/* SoundCloud-like icon */}
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" className="w-8 h-8 fill-current text-orange-500">
          <path d="M128 128c0-35.3 28.7-64 64-64H448c35.3 0 64 28.7 64 64V384c0 35.3-28.7 64-64 64H192c-35.3 0-64-28.7-64-64V128zm64 0V384H448V128H192zm-64 0H64V384H128V128zM0 128H64V384H0V128z"/>
        </svg>
        <span>Track Details</span>
      </div>

      {errorMessage && (
        <div className="bg-red-900 text-red-200 p-3 rounded-md mb-6 max-w-6xl mx-auto" role="alert">
          {errorMessage}
        </div>
      )}

      {/* Main Content Area - Now arranged vertically */}
      <div className="flex flex-col gap-8 max-w-6xl mx-auto">

        {/* 1. Cover Image Section (Square) */}
        <div
          className="bg-gray-800 rounded-lg p-6 flex flex-col items-center justify-center relative aspect-square max-w-full lg:max-w-[500px] lg:mx-auto"
          onDrop={handleCoverImageDrop}
          onDragOver={handleDragOver}
          onClick={() => document.getElementById('cover-image-upload-input')?.click()}
          aria-label="Upload or drag cover image"
          role="button"
          tabIndex={0}
        >
          <input
            key={manualCoverUploadInputKey} // Key to reset input and allow same file upload again
            id="cover-image-upload-input"
            type="file"
            accept="image/*"
            onChange={handleCoverImageFileInputChange}
            className="hidden"
          />
          {coverImageUrl ? (
            <>
              <img src={coverImageUrl} alt={coverImageAltText} className="absolute inset-0 object-cover w-full h-full rounded-lg" />
              <button
                onClick={handleDownloadCover}
                className="absolute bottom-4 right-4 bg-gray-700 p-2 rounded-full shadow-lg hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors z-10"
                aria-label="Download cover image"
              >
                <i className="fas fa-download text-white"></i>
              </button>
            </>
          ) : (
            <div className="border-2 border-dashed border-gray-600 rounded-lg h-full w-full flex flex-col items-center justify-center text-gray-400 cursor-pointer p-4">
              {isLoading && !isAnalyzingLink && audioFile && aiAnalysisProgress < 100 ? ( // Only show "Generating cover" if AI is generating for audio, not link analysis or just idle
                <div className="flex flex-col items-center text-center">
                  <i className="fas fa-spinner fa-spin text-4xl mb-4 text-blue-500" aria-label="Loading animation"></i>
                  <span className="text-lg">Generating cover image...</span>
                  <span className="text-sm text-gray-500 mt-2">This may take a moment.</span>
                </div>
              ) : (
                <>
                  <i className="fas fa-image text-5xl mb-4" aria-hidden="true"></i>
                  <span className="text-lg font-semibold">Add New Cover Image</span>
                  <span className="text-sm mt-2">Drag your image file here or click to upload one.</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* 2. Audio File Analysis Section (Rectangular) */}
        <div
          className="bg-gray-800 rounded-lg p-6 flex flex-col items-center justify-center relative min-h-[150px]"
          onDrop={handleAudioFileDrop}
          onDragOver={handleDragOver}
          onClick={() => document.getElementById('audio-upload-input')?.click()}
          aria-label="Upload or drag audio file"
          role="button"
          tabIndex={0}
        >
          <input
            id="audio-upload-input"
            type="file"
            accept="audio/*"
            onChange={handleAudioFileInputChange}
            className="hidden"
          />
          {audioFile || (trackLink && isAnalyzingLink) || (trackLink && isLoading && aiAnalysisProgress < 100) ? (
            <div className="flex flex-col items-center text-center">
              {audioFile && <i className="fas fa-file-audio text-5xl mb-4 text-blue-400"></i>}
              {isAnalyzingLink && <i className="fas fa-link text-5xl mb-4 text-purple-400"></i>}
              
              <span className="text-lg font-semibold text-gray-200">
                {audioFile ? audioFile.name : (trackLink && isAnalyzingLink ? 'Analyzing Track Link...' : 'Track Link Analysis Started...')}
              </span>
              
              {/* Progress for file upload */}
              {audioFile && uploadProgress < 100 && isLoading && (
                <>
                  <div className="flex items-center space-x-2 mt-4 w-full px-8">
                    <div className="flex-1 h-2 bg-gray-700 rounded-full">
                      <div
                        className="h-full bg-green-500 rounded-full transition-all duration-500"
                        style={{ width: `${uploadProgress}%` }}
                      ></div>
                    </div>
                    <span className="text-sm text-gray-400">{uploadProgress}%</span>
                  </div>
                  <span className="text-sm text-gray-400 mt-2">Uploading audio file...</span>
                </>
              )}

              {/* Progress for AI analysis */}
              {isLoading && aiAnalysisProgress < 100 && (audioFile && uploadProgress === 100 || isAnalyzingLink) && (
                <>
                  <div className="flex items-center space-x-2 mt-4 w-full px-8">
                    <div className="flex-1 h-2 bg-gray-700 rounded-full">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all duration-500"
                        style={{ width: `${aiAnalysisProgress}%` }}
                      ></div>
                    </div>
                    <span className="text-sm text-gray-400">{aiAnalysisProgress}%</span>
                  </div>
                  <span className="text-sm text-gray-400 mt-2">Analyzing audio and generating metadata...</span>
                </>
              )}
              
              {/* Completion message */}
              {!isLoading && (audioFile || trackLink) && (
                <span className="text-sm text-gray-400 mt-2">
                  {audioFile ? 'Audio file loaded and analyzed.' : 'Track link analyzed.'}
                </span>
              )}
            </div>
          ) : (
            <div className="border-2 border-dashed border-gray-600 rounded-lg h-full w-full flex flex-col items-center justify-center text-gray-400 cursor-pointer p-4">
              <i className="fas fa-music text-5xl mb-4" aria-hidden="true"></i>
              <span className="text-lg font-semibold">Upload or drag your audio file here</span>
              <span className="text-sm mt-2">Supported formats: MP3, WAV, FLAC, AAC</span>
            </div>
          )}
        </div>

        {/* 3. Track Details Form Section */}
        <div className="bg-gray-800 rounded-lg p-6">
          <form className="space-y-6" onSubmit={handleTrackLinkAnalysis}>
            {/* Track Link */}
            <div>
              <label htmlFor="track-link" className="block text-sm font-medium text-gray-300 mb-1">
                Track Link <i className="fas fa-link text-blue-400"></i>
              </label>
              <div className="flex gap-2">
                <input
                  id="track-link"
                  type="url"
                  placeholder="Paste SoundCloud track, set, or live performance link"
                  className="flex-1 bg-gray-700 text-gray-200 border border-gray-600 rounded-md p-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  value={trackLink}
                  onChange={(e) => {
                    setTrackLink(e.target.value);
                    if (!e.target.value) {
                      setTrackType('unknown'); // Reset type if link is cleared
                    }
                  }}
                  aria-label="SoundCloud track link"
                />
                <button
                  type="submit"
                  className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={isAnalyzingLink || isLoading}
                  aria-label="Analyze track link"
                >
                  {isAnalyzingLink || isLoading ? 'Analyzing...' : 'Analyze'}
                </button>
              </div>
            </div>

            {/* Detected Track Type */}
            {(trackType !== 'unknown' || isAnalyzingLink) && (
              <div>
                <label htmlFor="track-type" className="block text-sm font-medium text-gray-300 mb-1">
                  Detected Track Type <i className="fas fa-info-circle text-gray-400"></i>
                </label>
                <div
                  id="track-type"
                  className="bg-gray-700 text-gray-200 border border-gray-600 rounded-md p-2 w-full flex items-center"
                  aria-live="polite"
                >
                  {isAnalyzingLink ? (
                    <span className="text-gray-400 italic flex items-center">
                      <i className="fas fa-spinner fa-spin mr-2"></i> Detecting...
                    </span>
                  ) : (
                    <span className="capitalize">{trackType.replace('-', ' ')}</span>
                  )}
                </div>
              </div>
            )}

            {/* Track Title */}
            <div>
              <label htmlFor="track-title" className="block text-sm font-medium text-gray-300 mb-1">
                Track Title
              </label>
              <input
                type="text"
                id="track-title"
                className="bg-gray-700 text-gray-200 border border-gray-600 rounded-md p-2 w-full focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="Enter track title"
                value={trackTitle}
                onChange={(e) => setTrackTitle(e.target.value)}
                disabled={isLoading}
                aria-required="true"
              />
            </div>

            {/* Main Artist */}
            <div>
              <label htmlFor="main-artist" className="block text-sm font-medium text-gray-300 mb-1">
                Main Artist
              </label>
              <input
                type="text"
                id="main-artist"
                className="bg-gray-700 text-gray-200 border border-gray-600 rounded-md p-2 w-full focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="Enter main artist"
                value={mainArtist}
                onChange={(e) => setMainArtist(e.target.value)}
                disabled={isLoading}
              />
            </div>

            {/* Genre */}
            <div>
              <label htmlFor="genre" className="block text-sm font-medium text-gray-300 mb-1">
                Genre
              </label>
              <select
                id="genre"
                className="bg-gray-700 text-gray-200 border border-gray-600 rounded-md p-2 w-full focus:ring-blue-500 focus:border-blue-500 outline-none appearance-none"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                disabled={isLoading}
              >
                <option value="" disabled>Select a genre or let AI suggest</option>
                {SOUNDCLOUD_GENRES.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>

            {/* Tags */}
            <div>
              <label htmlFor="tags" className="block text-sm font-medium text-gray-300 mb-1">
                Tags (comma-separated)
              </label>
              <input
                type="text"
                id="tags"
                className="bg-gray-700 text-gray-200 border border-gray-600 rounded-md p-2 w-full focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="e.g., electronic, chill, instrumental"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                disabled={isLoading}
              />
            </div>

            {/* Description */}
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-300 mb-1">
                Description
              </label>
              <textarea
                id="description"
                rows={4}
                className="bg-gray-700 text-gray-200 border border-gray-600 rounded-md p-2 w-full focus:ring-blue-500 focus:border-blue-500 outline-none resize-y"
                placeholder="Enter a captivating description for your track"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={isLoading}
              ></textarea>
            </div>

            {/* Track Privacy */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Track Privacy
              </label>
              <div className="flex space-x-4">
                <label className="inline-flex items-center">
                  <input
                    type="radio"
                    className="form-radio text-blue-600"
                    name="privacy"
                    value="public"
                    checked={trackPrivacy === 'public'}
                    onChange={() => setTrackPrivacy('public')}
                    disabled={isLoading}
                  />
                  <span className="ml-2 text-gray-300">Public</span>
                </label>
                <label className="inline-flex items-center">
                  <input
                    type="radio"
                    className="form-radio text-blue-600"
                    name="privacy"
                    value="private"
                    checked={trackPrivacy === 'private'}
                    onChange={() => setTrackPrivacy('private')}
                    disabled={isLoading}
                  />
                  <span className="ml-2 text-gray-300">Private</span>
                </label>
                <label className="inline-flex items-center">
                  <input
                    type="radio"
                    className="form-radio text-blue-600"
                    name="privacy"
                    value="schedule"
                    checked={trackPrivacy === 'schedule'}
                    onChange={() => setTrackPrivacy('schedule')}
                    disabled={isLoading}
                  />
                  <span className="ml-2 text-gray-300">Schedule release</span>
                </label>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);