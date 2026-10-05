#include <iostream>
#include <fstream>
#include <vector>
#include <chrono>

class Entry{
    public:
        std::chrono::sys_seconds timestamp;
        unsigned BG;
    
    Entry(std::chrono::sys_seconds timestamp, unsigned BG){
        this->timestamp = timestamp;
        this->BG = BG;
    }
    std::chrono::sys_seconds getTimestamp();
    unsigned getBG();
    
};

class Timeline{
    public: 
        std::vector<Entry> Entries;
    void addEntry(Entry entry);
    std::vector<Entry> getEntries();
    void printEntries();
};



int main(int argc, char** argv){

    //declare the input file and line in which we will store each read line
    std::string line;
    std::ifstream inFile("in.csv");

    //loop that finds the first line which contains sensor data, this is marked by the string
    //;Sensor; in that line, after that it reads one more line becaues it s the header and then
    //we can read the actual data
    while(std::getline(inFile, line)){
        if(line.find(";Sensor;")==std::string::npos){
            continue;
        }
        else{
            std::getline(inFile,line);
            break;
        }
    }
    auto entryNo = 0;
    while(std::getline(inFile,line)){
        entryNo++;
        std::vector<std::string> fields;
        std::size_t start = 0;
        std::size_t semiColonPos;
        while((semiColonPos = line.find(';', start)) != std::string::npos){
            fields.push_back(line.substr(start, semiColonPos - start));
            start = semiColonPos + 1;
        }
        fields.push_back(line.substr(start));
    }

    auto getDate = [](auto sys_Sec){
        
    }

    return 0;
}