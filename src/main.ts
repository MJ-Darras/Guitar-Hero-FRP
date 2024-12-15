import "./style.css";

import { fromEvent, interval, merge } from "rxjs";
import { map, filter, scan, take, every , withLatestFrom, switchMap, startWith} from "rxjs/operators";
import * as Tone from "tone";
import { SampleLibrary } from "./tonejs-instruments";
import { not } from "rxjs/internal/util/not";
import { Action } from "rxjs/internal/scheduler/Action";    

/** Constants */

const Viewport = {
    CANVAS_WIDTH: 200,
    CANVAS_HEIGHT: 400,
    LAST_POSITION: 350,
} as const;

const Constants = {
    TICK_RATE_MS: 10,   
    SONG_NAME: "SleepingBeauty",
} as const;

const Note = {
    RADIUS: 0.07 * Viewport.CANVAS_WIDTH,
    TAIL_WIDTH: 10,
} as const;

const Time = {
    OFFSET: 3.5,
    FORGIVING_MARGIN: 0.30,
} as const;


/*
 * This game is to be played using the HJKL keys on the keyboard!
*/

/** User input */
type Key = "KeyH" | "KeyJ" | "KeyK" | "KeyL" | "Escape";

type Event = "keydown" | "keyup" | "keypress";

/** Types */

type Body = Readonly<{
    r: number,
    cx: string,
    cy: number,
    style: string,
    class: string,
    rendered: boolean,
    note: NoteData,
    played: boolean
}> 

type NoteData = Readonly<{
    user_played: boolean;
    instrument: string;
    velocity: number;
    pitch: number;
    start: number;
    end: number;
    played_at: number | null;
}>;

type State = Readonly<{
    gameEnd: boolean;
    circles: ReadonlyArray<Body>;
    notes: ReadonlyArray<NoteData>;
    autoNotes: ReadonlyArray<NoteData>;
    userNotes: ReadonlyArray<NoteData>;
    noteIndex: number;
    time: number;
    lastNote: NoteData;
    score: number;
    paused: boolean;
}>;

/**
 * Updates the state by proceeding with one time step.
 *
 * It handles the progression of time and updates the notes/circles 
 * 
 * @param state (Current)
 * @returns Updated state
 */
const tick = (s: State) => {
    
    const updatedTime = s.time + (Constants.TICK_RATE_MS / 1000) //updates the current time 

    const roundedTime = Math.round(updatedTime * 1000) / 1000; //Extra saftey measure to make sure there are no floating point operation inaccuracies
    
    const updatedNotes = s.autoNotes
    .filter(note => note.end > s.time)  // remove notes that ended before the current time
    .map(note => {
        if(note.played_at === null && note.start < roundedTime && note.start >= s.time ) {  //criteria to check for which notes are to be played
            return {
            ...note,
            played_at: s.time,  //map the play time to each played note
            } as NoteData;
        } 
        else {
            return note;        //otherwise if not played just keep the note as is
        }
    });

    
    const newNotes = s.userNotes
    .filter(note => (note.start < roundedTime + Time.OFFSET) && (note.start >= s.time + Time.OFFSET) )  //filter notes that we need to attach to circles


    /**
     * Determines column and color based off the note pitch.
     *
     * @param pitch
     * @returns Array of feature strings
     */
    const circleX = (pitch: number) : string[]=> {
        const cx = pitch % 4;                       // mod 4 as there are 4 columns
        switch(cx){
            case 0: return ["20%", "fill: green"];
            case 1: return ["40%", "fill: red"];
            case 2: return ["60%", "fill: blue"];
            case 3: return ["80%", "fill: yellow"];
            default: return ["20%", "fill: green"];
        }
    }

    const newCircles = newNotes     //create the circles for the notes and store the notes in them.
    .map(note => ({
        r: Note.RADIUS,
        cx: circleX(note.pitch)[0],
        cy: 0,                      // Start at the top of the canvas
        style: circleX(note.pitch)[1],
        class: "shadow",
        note: note,
        rendered: true,             //set this as true because we want to render it in the earliest opportunity
        played: false
    })as Body);

    const updatedCircles = s.circles    //update already existing circles
    .filter(circle => circle.rendered)
    .map((circle) => {
        if (circle.cy >= Viewport.LAST_POSITION){    
            return{
                ...circle,
                cy: circle.cy,
                rendered: false         //if they reached the last allowed location we should not render them further
            } as Body;
        } 
        else {
            return{
                ...circle,
                cy: circle.cy + 1,      //otherwise increment their position by one
            } as Body;
        }
    }).concat(newCircles);              //group all circles together

    /**
     * Checks if current time passed the last note to play
     *
     * @param None
     * @returns Boolean
     */
    const didGameEnd = () => {
        if(s.lastNote.end >= 0 && s.time > s.lastNote.end){ 
            return true
        }
        return false;
    }

    return {                        //returns the new state
        ...s,
        gameEnd: didGameEnd(),
        circles: updatedCircles,
        notes: updatedNotes,
        noteIndex: s.noteIndex,
        time: roundedTime,
        autoNotes: updatedNotes,
        userNotes: s.userNotes,
    }as State;
};

/** Handling notes */

/**
 * Converts notes from csv string to NoteData types 
*
* @param Csv (String of csv data)
* @returns NoteData array
*/
const parseNotes = (csv: string) => {
    return  csv
    .trim()
    .split("\n")        //splits by line
    .slice(1)           //removes headers
    .map((row) => {     //maps each line to a note and returns it
        const [user_played, instrument, velocity, pitch, start, end] = row.split(",");
        return {
            user_played: user_played.trim() === 'True',
            instrument,
            velocity: Number(velocity),
            pitch: Number(pitch),
            start: Math.round((Number(start)) *100)/100,
            end: Number(end),
            played_at: null,
        } as NoteData;
    });      
};

/**
 * Finds the last note to be playing 
 *
 * @param notes array
 * @returns Note
*/
const findLast = (notes : ReadonlyArray<NoteData>) => {
    const lastNote = notes.reduce((acc,other) => {   //compares the notes to find which one ends last
        if(other.end > acc.end){ 
            return other;
        }
        else{
            return acc;
        }
    }, notes[0]);
    
    return lastNote;
}

/** Rendering (side effects) */

/**
 * Displays a SVG element on the canvas. Brings to foreground.
 * @param elem SVG element to display
 */
const show = (elem: SVGGraphicsElement) => {
    elem.setAttribute("visibility", "visible");
    elem.parentNode!.appendChild(elem);
};

/**
 * Hides a SVG element on the canvas.
 * @param elem SVG element to hide
 */
const hide = (elem: SVGGraphicsElement) =>
    elem.setAttribute("visibility", "hidden");

/**
 * Creates an SVG element with the given properties.
 *
 * See https://developer.mozilla.org/en-US/docs/Web/SVG/Element for valid
 * element names and properties.
 *
 * @param namespace Namespace of the SVG element
 * @param name SVGElement name
 * @param props Properties to set on the SVG element
 * @returns SVG element
 */
const createSvgElement = (
    namespace: string | null,
    name: string,
    props: Record<string, string> = {},
) => {
    const elem = document.createElementNS(namespace, name) as SVGElement;
    Object.entries(props).forEach(([k, v]) => elem.setAttribute(k, v));
    return elem;
};

/**
 * This is the function called on page load. Your main game loop
 * should be called here.
 */
export function main(
    samples: { [key: string]: Tone.Sampler }, Notes:  ReadonlyArray<NoteData>,  UserNotes:  ReadonlyArray<NoteData>, 
    AutoNotes:  ReadonlyArray<NoteData>, LastNote: NoteData
) {
    // Canvas elements
    const svg = document.querySelector("#svgCanvas") as SVGGraphicsElement &
        HTMLElement;
    const preview = document.querySelector(
        "#svgPreview",
    ) as SVGGraphicsElement & HTMLElement;
    const gameover = document.querySelector("#gameOver") as SVGGraphicsElement &
        HTMLElement;
    const container = document.querySelector("#main") as HTMLElement;

    const gamePaused = document.querySelector("#gamePaused") as SVGGraphicsElement &    // extra element to display while game is paused.
        HTMLElement;

    svg.setAttribute("height", `${Viewport.CANVAS_HEIGHT}`);
    svg.setAttribute("width", `${Viewport.CANVAS_WIDTH}`);

    // Text fields
    const multiplier = document.querySelector("#multiplierText") as HTMLElement;
    const scoreText = document.querySelector("#scoreText") as HTMLElement;
    const highScoreText = document.querySelector(
        "#highScoreText",
    ) as HTMLElement;


    const initialState: State = Object.freeze({     //initializes the values for the state and makes them unchangeable
        gameEnd: false,
        circles: [],
        notes: Notes,
        userNotes: UserNotes,
        autoNotes: AutoNotes,
        noteIndex: 0,
        time: -Time.OFFSET,
        lastNote: LastNote,
        score: 0,
        paused: false
    } as State);
    
    /**
     * Renders the current state to the canvas.
     *
     * This updates the visual elements based on their current state 
     *
     * @param state (Current)
     */
    const render = (s: State) => {

        scoreText.textContent = s.score.toString();     //update score text
        
        //Selecting the svgs
        const circles = svg.querySelectorAll(".shadow");    // select all circles
        circles.forEach(circle => circle.remove())          // remove them
        
        s.circles          //render the circles again
        .filter(circle =>  circle.cy < Viewport.LAST_POSITION)
        .forEach((circle) => {
            
            const newCircle = createSvgElement(svg.namespaceURI, "circle", {    //set attributes to circles
                r: `${circle.r}`,
                cx: `${circle.cx}`,
                cy: `${circle.cy}`,
                style: `${circle.style}`,
                class: `${circle.class}`,
            });
            
            svg.appendChild(newCircle);
            
        })
    };

    
    /**
     * A random number generator which provides two pure functions
     * `hash` and `scaleToRange`.
    */
   abstract class RNG {
       // LCG using GCC's constants
       private static m = 0x80000000; // 2**31
       private static a = 1103515245;
       private static c = 12345;
       
    /**
     * Call `hash` repeatedly to generate the sequence of hashes.
     * @param seed
     * @returns a hash of the seed
    */

    public static hash = (seed: number) => (RNG.a * seed + RNG.c) % RNG.m;
      
    /**
    * Takes hash value and scales it to the range [0, 1]
    * @param hash 
    * @returns a scaled version of the input
    */
    public static scale = (hash: number) => (hash) / (RNG.m - 1);
    }
    

    /**
     * Handles playing the actual note
     * @param s currentNote, duration, pitch
     * @returns None
    */
    const notePlayHelper = (currentNote: NoteData, duration: number, pitch: number) => {
        if(currentNote.played_at == null){
                samples[`${currentNote.instrument}`].triggerAttack(
                    Tone.Frequency(pitch, "midi").toNote(), // Convert MIDI note to frequency
                    undefined, // Use default time for note onset
                    (currentNote.velocity / 127), // Set velocity to quarter of the maximum velocity
                );
                
                // After 1 second, stop the note (trigger release)
                setTimeout(() => {
                    samples[`${currentNote.instrument}`].triggerRelease(
                        Tone.Frequency(pitch, "midi").toNote(), // Convert MIDI note to frequency
                    );
                }, duration);
            }
    }
    
    /**
     * Handles checking the different criteria before playing notes 
     * @param s currentNote, time 
     * @returns None
    */
    const playNote = (currentNote: NoteData, time: number) => {
        
        if (Math.abs(currentNote.start - Math.abs(time)) > Time.FORGIVING_MARGIN){           //if note played at the wrong time create random attributes and play them.
            const duration = (RNG.scale(RNG.hash(currentNote.start)) * 0.5);
            const pitch = (RNG.scale(RNG.hash(currentNote.pitch)) * 100) 
            notePlayHelper(currentNote,duration, pitch);
        }
        
        else{
            notePlayHelper(currentNote, ((currentNote.end - currentNote.start)*1000), currentNote.pitch )
        }
    }
        
        const keyToColumn: {[key:string]: string} = {
            "H": "20%", // First column
            "J": "40%", // Second column
            "K": "60%", // Third column
            "L": "80%"  // Fourth column
        };

        const tick$ = interval(Constants.TICK_RATE_MS);     //ticks stream

        const gameClock$ = tick$.pipe(map(_ => "tick"))     //map each tick to a unique string 

        const key$ = fromEvent<KeyboardEvent>(document, "keydown");     // stream of keydown events
        
        /**
        * Filters the presses to make sure they behave as expected
        * @param keyCode
        * @returns filtered keypress stream
        */
        const fromKey = (keyCode: Key) =>
            key$.pipe(
            filter(({ code }) => code === keyCode),     //makes sure the presses dont repeat or overlap 
            filter(({ repeat }) => !repeat)
            );
        
        //mapping each press to a unique string 
        const keyPressH$ = fromKey("KeyH").pipe(map(_ => "H"));
        const keyPressJ$ = fromKey("KeyJ").pipe(map(_ => "J"));
        const keyPressK$ = fromKey("KeyK").pipe(map(_ => "K"));
        const keyPressL$ = fromKey("KeyL").pipe(map(_ => "L"));
        const keyPressEsc$ = fromKey("Escape").pipe(map(_ => "Esc"));

        const keyPress$ = merge(keyPressH$, keyPressJ$, keyPressK$, keyPressL$, keyPressEsc$)   //merge press streams

        const action$ = merge(gameClock$, keyPress$)        //merge actions into a stream
        
        const state$ = action$.pipe(                //accumilate new states
            scan((s: State, action : any) => {
                if(action === "Esc"){               // reverse the paused boolean
                    return{
                        ...s,
                        paused: !s.paused
                    };
                }
                else if (s.paused === false){
                    if (action === "tick"){
                        return tick(s);         // perform the tick
                    }
                    else{
                        //play the correct note in case multiple notes overlap and satisfy conditions
                        const eligibleCircles = s.circles
                        .filter(circle => keyToColumn[action] === circle.cx && Math.abs(circle.note.start - s.time) < 0.7 && circle.rendered && !circle.played);
    
                        const prioritizedCircle = eligibleCircles.reduce((acc,other) => {
                            if(other.note.start < acc.note.start){
                                return other;
                            }
                            else{
                                return acc;
                            }
                        }, eligibleCircles[0]);
    
                        const updatedCircles = s.circles.map(circle => {
                            if(circle === prioritizedCircle){
                                return {...circle, rendered: false, played: true};
                            }
                            return circle;
                        }) 
                        
                        // calculate how many points to reward player
                        const addedPoints = () => {
                            if(prioritizedCircle){
                                //if player hits note within a reasonable range then 
                                if(Math.abs(prioritizedCircle.note.start - s.time) < Time.FORGIVING_MARGIN){
                                    return 10;
                                }
                                else{
                                    return 5;
                                }
                            }
                            return 0;
                        }
                        return {        //return a new state with desired data
                            ...s, 
                            circles: updatedCircles,
                            score: s.score + addedPoints()
                        };
                    }
                    
                }
                else{
                    return s;
                }
                
                //start accumilating using
            }, initialState)
        )
    

    //perform all the changes in the subscribe function.
    const source$ = state$
        .subscribe((s: State) => {
            render(s)
            
            //play each note the user plays
            s.circles
            .filter(circle => !circle.rendered && circle.played)
            .forEach(circle => playNote(circle.note, s.time))

            //play each note in the background
            s.autoNotes
            .filter( note => (Math.round((note.start) *1000)/1000 - s.time  == 0))
            .forEach((note) => {playNote(note, s.time)})

            //handle end game screen
            if (s.gameEnd) {
                show(gameover);
            } else {
                hide(gameover);
                //handle pause game screen
                if (s.paused) {
                    show(gamePaused);
                } else {
                    hide(gamePaused);
                }
            }
        });
    
}

// The following simply runs your main function on window load.  Make sure to leave it in place.
// You should not need to change this, beware if you are.
if (typeof window !== "undefined") {
    // Load in the instruments and then start your game!
    const samples = SampleLibrary.load({
        instruments: [
            "bass-electric",
            "violin",
            "piano",
            "trumpet",
            "saxophone",
            "trombone",
            "flute",
        ], // SampleLibrary.list,
        baseUrl: "samples/",
    });

    const startGame = (contents: string) => {
        //prepare the lists before user clicks on the screen
        const notes = parseNotes(contents)
        const userNotes = notes.filter(note => note.user_played)
        const autoNotes =  notes.filter(note => !note.user_played)
        const lastNote = findLast(notes)
        //actual start of the game
        document.body.addEventListener(
            "mousedown",
            function () {
                main(samples, notes, userNotes, autoNotes, lastNote);
            },
            { once: true },
        );
    };

    const { protocol, hostname, port } = new URL(import.meta.url);
    const baseUrl = `${protocol}//${hostname}${port ? `:${port}` : ""}`;

    Tone.ToneAudioBuffer.loaded().then(() => {
        for (const instrument in samples) {
            samples[instrument].toDestination();
            samples[instrument].release = 0.5;
        }

        fetch(`${baseUrl}/assets/${Constants.SONG_NAME}.csv`)
            .then((response) => response.text())
            .then((text) => {
                startGame(text);
            })
            .catch((error) =>
                console.error("Error fetching the CSV file:", error),
            );
    });
}
